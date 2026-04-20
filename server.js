const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
const cors = require('cors')

const path = require('path')

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

async function claudeCreate(params) {
    const response = await anthropic.messages.create(params)
    supabase.from('uso_tokens').insert({
        modelo: params.model || 'claude-sonnet-4-6',
        tokens_entrada: response.usage?.input_tokens || 0,
        tokens_saida: response.usage?.output_tokens || 0
    }).then(({ error }) => { if (error) console.error('Erro ao salvar tokens:', error.message) })
    return response
}

const LIMITE_MENSAGENS = 30

async function gerarEmbedding(texto) {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`
        },
        body: JSON.stringify({ model: 'voyage-3-lite', input: texto })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.detail || 'Erro Voyage')
    return data.data[0].embedding
}

async function buscarSupabase(pergunta, limite = 4) {
    try {
        const embedding = await gerarEmbedding(pergunta)
        const { data, error } = await supabase.rpc('buscar_similar', {
            query_embedding: embedding,
            match_count: limite
        })
        if (error) throw new Error(error.message)
        if (!data || data.length === 0) return ''
        return data.map(d => d.conteudo).join('\n\n---\n\n')
    } catch (err) {
        console.error('Erro busca Supabase:', err.message)
        return ''
    }
}

async function carregarConversa(numero) {
    const { data, error } = await supabase
        .from('conversas')
        .select('*')
        .eq('numero', numero)
        .single()

    if (error || !data) return { nome: '', tipo: '', resumo: '', mensagens: [], ativo: false, pendente_grupo: '' }
    return {
        nome: data.nome || '',
        tipo: data.tipo || '',
        resumo: data.resumo || '',
        mensagens: data.mensagens || [],
        ativo: data.ativo || false,
        pendente_grupo: data.pendente_grupo || ''
    }
}

async function salvarConversa(numero, nome, tipo, resumo, mensagens, ativo = false) {
    const { error } = await supabase.from('conversas').upsert({
        numero,
        nome,
        tipo,
        resumo,
        mensagens,
        ativo,
        atualizado_em: new Date().toISOString()
    }, { onConflict: 'numero' })
    if (error) console.error('Erro ao salvar conversa:', error.message)
}

async function gerarResumo(nome, resumoAnterior, mensagens) {
    try {
        const historico = mensagens.map(m => `${m.role === 'user' ? 'Corretor' : 'Bellinha'}: ${m.content}`).join('\n')
        const response = await claudeCreate({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            system: 'Você resume conversas de atendimento imobiliário de forma concisa. Foque em: empreendimentos consultados, dúvidas levantadas e informações importantes trocadas.',
            messages: [{
                role: 'user',
                content: `Corretor: ${nome}\n\nResumo anterior: ${resumoAnterior || 'nenhum'}\n\nConversa:\n${historico}\n\nGere um resumo atualizado em até 3 frases.`
            }]
        })
        return response.content[0].text
    } catch (err) {
        console.error('Erro ao gerar resumo:', err.message)
        return resumoAnterior
    }
}

async function perguntarClaude(nome, resumo, historico, contexto, pergunta, imagemBase64 = null) {
    try {
        const historicoFormatado = historico.map(m => ({
            role: m.role,
            content: m.content
        }))

        const system = `Você é Bellinha, assistente virtual da Bella Casa & Okada.
Responda sempre no feminino e use primeira pessoa do plural ao falar da empresa.
Seja profissional, próxima e direta. Use emojis com moderação.
Responda apenas com base no contexto fornecido.
Se não souber, diga: "Não tenho esse dado disponível. Recomendo consultar o gerente comercial."

REGRAS:
- Sempre confirme o empreendimento antes de falar de pagamento
- Inclua sempre o aviso do Gerlotes ao informar valores
- Nunca misture dados de empreendimentos diferentes
- Respostas curtas e objetivas
- Chame o corretor pelo nome (${nome || 'corretor'}) quando apropriado
- NUNCA use asteriscos, underlines ou qualquer marcação de texto. Use apenas texto puro e emojis

${resumo ? `RESUMO DO HISTÓRICO:\n${resumo}\n` : ''}
CONTEXTO DOS EMPREENDIMENTOS:
${contexto || 'Sem contexto disponível.'}`

        const response = await Promise.race([
            claudeCreate({
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system,
                messages: [...historicoFormatado, {
                    role: 'user',
                    content: imagemBase64 ? [
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagemBase64 } },
                        { type: 'text', text: pergunta || 'O que você vê nessa imagem? Relate ao contexto dos empreendimentos se relevante.' }
                    ] : pergunta
                }]
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 25000)
            )
        ])
        return response.content[0].text
    } catch (err) {
        console.error('Erro no Claude:', err.message)
        return 'Não consegui processar sua pergunta agora. Tente novamente.'
    }
}

async function baixarImagemBase64(msg) {
    try {
        const response = await fetch(`${process.env.EVOLUTION_URL}/chat/getBase64FromMediaMessage/${process.env.EVOLUTION_INSTANCE}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.EVOLUTION_KEY
            },
            body: JSON.stringify({ message: { key: msg.data.key, message: msg.data.message } })
        })
        const data = await response.json()
        return data.base64 || null
    } catch (err) {
        console.error('Erro ao baixar imagem:', err.message)
        return null
    }
}

async function enviarWhatsApp(numero, texto) {
    try {
        await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.EVOLUTION_INSTANCE}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': process.env.EVOLUTION_KEY
            },
            body: JSON.stringify({ number: numero, text: texto })
        })
    } catch (err) {
        console.error('Erro ao enviar WhatsApp:', err.message)
    }
}

app.post('/whatsapp', async (req, res) => {
    try {
        const msg = req.body

        const texto = msg?.data?.message?.conversation ||
                      msg?.data?.message?.extendedTextMessage?.text ||
                      msg?.data?.message?.imageMessage?.caption || ''

        const imagemPresente = !!msg?.data?.message?.imageMessage
        const numero = msg?.data?.key?.remoteJid
        const fromMe = msg?.data?.key?.fromMe
        const isGrupo = numero?.endsWith('@g.us')

        if ((!texto && !imagemPresente) || !numero || fromMe) return res.sendStatus(200)

        // Em grupos: controle de ativo + menção
        const mencionada = /bel{1,2}inha/i.test(texto)
        const pedindoParar = /para(r|rar)?|encerr(ar?|a)|obrigad[ao]|tchau|até mais|valeu/i.test(texto)

        if (isGrupo) {
            const { nome: nomeGrupo, tipo: tipoGrupo, resumo: resumoGrupo, mensagens: mensagensGrupo, ativo: ativoGrupo } = await carregarConversa(numero)
            const remetente = msg?.data?.key?.participant || numero

            // Carrega dados do remetente
            const { data: dadosRemetente } = await supabase
                .from('conversas')
                .select('nome, tipo, pendente_grupo')
                .eq('numero', remetente)
                .single()

            const nomeRemetente = dadosRemetente?.nome || ''
            const tipoRemetente = dadosRemetente?.tipo || ''
            const pendente = dadosRemetente?.pendente_grupo || ''

            // Se estava aguardando nome deste remetente neste grupo
            if (pendente === numero) {
                const extracaoNome = await claudeCreate({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 50,
                    system: 'Extraia apenas o primeiro nome da mensagem. Responda APENAS em JSON: {"nome": "..."}. Se não identificar um nome, use o texto original.',
                    messages: [{ role: 'user', content: texto }]
                })
                let nomeSalvo = texto.trim()
                try {
                    const info = JSON.parse(extracaoNome.content[0].text)
                    nomeSalvo = info.nome || texto.trim()
                } catch {}

                await supabase.from('conversas').upsert({
                    numero: remetente, nome: nomeSalvo, pendente_grupo: '', atualizado_em: new Date().toISOString()
                }, { onConflict: 'numero' })

                await enviarWhatsApp(numero, `Prazer, ${nomeSalvo}! 😊 Como posso te ajudar?`)
                return res.sendStatus(200)
            }

            const labelRemetente = nomeRemetente
                ? (tipoRemetente ? `${nomeRemetente} (${tipoRemetente})` : nomeRemetente)
                : remetente

            mensagensGrupo.push({ role: 'user', content: `[${labelRemetente}]: ${texto}` })

            let novoAtivo = ativoGrupo
            if (mencionada) novoAtivo = true
            if (ativoGrupo && pedindoParar) novoAtivo = false

            if (mensagensGrupo.length >= LIMITE_MENSAGENS) {
                const novoResumo = await gerarResumo('Grupo', resumoGrupo, mensagensGrupo)
                await salvarConversa(numero, nomeGrupo, tipoGrupo, novoResumo, [], novoAtivo)
            } else {
                await salvarConversa(numero, nomeGrupo, tipoGrupo, resumoGrupo, mensagensGrupo, novoAtivo)
            }

            if (!novoAtivo) return res.sendStatus(200)

            if (ativoGrupo && pedindoParar) {
                await enviarWhatsApp(numero, 'De nada! 😊 Estarei aqui se precisar. Até mais!')
                return res.sendStatus(200)
            }

            // Se não conhece o remetente e foi mencionada, pede o nome
            if (mencionada && !nomeRemetente) {
                await supabase.from('conversas').upsert({
                    numero: remetente, nome: '', pendente_grupo: numero, atualizado_em: new Date().toISOString()
                }, { onConflict: 'numero' })
                await enviarWhatsApp(numero, 'Olá! 😊 Ainda não nos conhecemos. Qual é o seu nome?')
                return res.sendStatus(200)
            }
        }

        console.log('WhatsApp - De:', numero)
        console.log('WhatsApp - Texto:', texto)
        console.log('WhatsApp - Grupo:', isGrupo)

        let imagemBase64 = null
        if (imagemPresente) {
            imagemBase64 = await baixarImagemBase64(msg)
            console.log('Imagem baixada:', imagemBase64 ? 'sim' : 'falhou')
        }

        // Remove a menção do texto antes de processar
        const textoPuro = texto.replace(/@?bel{1,2}inha/gi, '').trim()

        let { nome, tipo, resumo, mensagens, ativo } = await carregarConversa(numero)

        // Em grupos, identifica quem está perguntando para o Claude
        if (isGrupo) {
            const remetente = msg?.data?.key?.participant || numero
            const { data: dadosRem } = await supabase.from('conversas').select('nome, tipo').eq('numero', remetente).single()
            nome = dadosRem?.nome || ''
            tipo = dadosRem?.tipo || ''
        }

        // Em grupos não faz onboarding
        if (!isGrupo) {
        // Primeira mensagem: pede o nome
        if (!nome) {
            if (mensagens.length === 0) {
                const boasVindas = 'Olá! 😊 Sou a Bellinha, assistente virtual da Bella Casa & Okada.\n\nAcho que a gente ainda não se conhece! Qual é o seu nome?'
                mensagens.push({ role: 'assistant', content: boasVindas })
                await salvarConversa(numero, '', '', '', mensagens)
                await enviarWhatsApp(numero, boasVindas)
                return res.sendStatus(200)
            }

            // Segunda mensagem: extrai o nome e pergunta imobiliária
            const extracaoNome = await claudeCreate({
                model: 'claude-sonnet-4-6',
                max_tokens: 50,
                system: 'Extraia apenas o primeiro nome da mensagem. Responda APENAS em JSON: {"nome": "..."}. Se não identificar um nome, use o texto original.',
                messages: [{ role: 'user', content: textoPuro }]
            })
            try {
                const info = JSON.parse(extracaoNome.content[0].text)
                nome = info.nome || textoPuro
            } catch {
                nome = textoPuro
            }
            mensagens.push({ role: 'user', content: textoPuro })
            const perguntaTipo = `Prazer, ${nome}! 😊 Você trabalha em alguma imobiliária? Se sim, qual? Ou é autônomo?`
            mensagens.push({ role: 'assistant', content: perguntaTipo })
            await salvarConversa(numero, nome, '', resumo, mensagens)
            await enviarWhatsApp(numero, perguntaTipo)
            return res.sendStatus(200)
        }
        } // fim do bloco !isGrupo

        // Terceira mensagem: salva imobiliária/autônomo (apenas individual)
        if (!isGrupo && !tipo) {
            const extracao = await claudeCreate({
                model: 'claude-sonnet-4-6',
                max_tokens: 50,
                system: 'Extraia o vínculo profissional da mensagem. Responda APENAS em JSON: {"tipo": "..."}. Se for autônomo use "Autônomo". Se mencionar imobiliária, extraia apenas o nome dela. Se não identificar, use o texto original.',
                messages: [{ role: 'user', content: textoPuro }]
            })

            try {
                const info = JSON.parse(extracao.content[0].text)
                tipo = info.tipo || textoPuro
            } catch {
                tipo = textoPuro
            }

            mensagens.push({ role: 'user', content: textoPuro })
            const saudacao = `Anotado! 😊 ${tipo === 'Autônomo' ? 'Autônomo, ' : `Da ${tipo}, `}${nome}! Pode perguntar, estou aqui para te ajudar!`
            mensagens.push({ role: 'assistant', content: saudacao })
            await salvarConversa(numero, nome, tipo, resumo, mensagens)
            await enviarWhatsApp(numero, saudacao)
            return res.sendStatus(200)
        }

        // Busca contexto no Supabase
        const contexto = await buscarSupabase(textoPuro)
        console.log('Contexto tamanho:', contexto.length)

        // Adiciona mensagem do usuário ao histórico
        mensagens.push({ role: 'user', content: textoPuro })

        // Gera resposta com histórico
        let resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contexto, textoPuro, imagemBase64)

        // Feature 3: detecta resposta insuficiente
        const respostaInsuficiente = /não tenho esse dado|não encontrei|sem (contexto|informaç)/i.test(resposta)
        if (respostaInsuficiente) {
            // Salva lacuna para revisão
            await supabase.from('lacunas').insert({
                pergunta: textoPuro,
                resposta_bellinha: resposta,
                numero
            })
            // Tenta busca mais ampla
            const contextoExtra = await buscarSupabase(textoPuro, 8)
            if (contextoExtra && contextoExtra.length > contexto.length) {
                console.log('Tentando com contexto expandido...')
                resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contextoExtra, textoPuro, imagemBase64)
            }
        }

        mensagens.push({ role: 'assistant', content: resposta })

        // Se atingiu 30 mensagens, gera resumo e limpa
        if (mensagens.length >= LIMITE_MENSAGENS) {
            console.log('Gerando resumo para', numero)
            resumo = await gerarResumo(nome, resumo, mensagens)
            mensagens = []
        }

        await salvarConversa(numero, nome, tipo, resumo, mensagens, ativo)
        await enviarWhatsApp(numero, resposta)

        return res.sendStatus(200)

    } catch (err) {
        console.error('Erro no WhatsApp:', err.message)
        return res.sendStatus(200)
    }
})

app.get('/analytics', async (req, res) => {
    const senha = req.headers['x-senha'] || req.query.senha
    if (senha !== process.env.DASHBOARD_PASSWORD) return res.status(401).json({ erro: 'Senha incorreta' })

    try {
        const { de, ate } = req.query
        let query = supabase.from('conversas').select('nome, tipo, mensagens, numero, atualizado_em')
        if (de) query = query.gte('atualizado_em', new Date(de).toISOString())
        if (ate) query = query.lte('atualizado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: conversas } = await query

        let lacunasQuery = supabase.from('lacunas').select('pergunta, criado_em').eq('revisado', false).order('criado_em', { ascending: false }).limit(10)
        if (de) lacunasQuery = lacunasQuery.gte('criado_em', new Date(de).toISOString())
        if (ate) lacunasQuery = lacunasQuery.lte('criado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: lacunas } = await lacunasQuery

        const { data: faqs } = await supabase.from('faq_gerado').select('arquivo, criado_em').order('criado_em', { ascending: false }).limit(5)

        let tokenQuery = supabase.from('uso_tokens').select('tokens_entrada, tokens_saida')
        if (de) tokenQuery = tokenQuery.gte('criado_em', new Date(de).toISOString())
        if (ate) tokenQuery = tokenQuery.lte('criado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: tokensData } = await tokenQuery
        const totalEntrada = tokensData?.reduce((s, r) => s + (r.tokens_entrada || 0), 0) || 0
        const totalSaida = tokensData?.reduce((s, r) => s + (r.tokens_saida || 0), 0) || 0
        const custoUSD = ((totalEntrada / 1_000_000) * 3) + ((totalSaida / 1_000_000) * 15)
        const budget = parseFloat(process.env.ANTHROPIC_BUDGET_USD || '0')

        const normalizar = str => str?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() || ''

        const stats = {
            total_corretores: conversas?.length || 0,
            total_mensagens: 0,
            por_corretor: [],
            por_imobiliaria: {},
            por_produto: {},
            lacunas_pendentes: lacunas || [],
            faqs_gerados: faqs || [],
            tokens: {
                entrada: totalEntrada,
                saida: totalSaida,
                custo_usd: custoUSD.toFixed(4),
                saldo_usd: budget > 0 ? Math.max(0, budget - custoUSD).toFixed(2) : null,
                budget_usd: budget > 0 ? budget : null
            }
        }

        const produtos = ['Noah Beach', 'NOA Garden', 'Noah']

        for (const conv of conversas || []) {
            const msgs = conv.mensagens || []
            const countUser = msgs.filter(m => m.role === 'user').length
            stats.total_mensagens += countUser

            if (conv.nome) {
                const tel = conv.numero?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
                stats.por_corretor.push({ nome: conv.nome, tipo: conv.tipo || 'Autônomo', mensagens: countUser, telefone: tel })
            }

            const imob = conv.tipo?.trim() || 'Autônomo'
            const imobKey = normalizar(imob)
            const imobLabel = stats.por_imobiliaria[imobKey]?.label || imob
            stats.por_imobiliaria[imobKey] = {
                label: imobLabel,
                count: (stats.por_imobiliaria[imobKey]?.count || 0) + countUser,
                corretores: (stats.por_imobiliaria[imobKey]?.corretores || 0) + (conv.nome ? 1 : 0)
            }

            for (const m of msgs) {
                if (m.role === 'user') {
                    for (const prod of produtos) {
                        if (m.content?.toLowerCase().includes(prod.toLowerCase())) {
                            stats.por_produto[prod] = (stats.por_produto[prod] || 0) + 1
                        }
                    }
                }
            }
        }

        stats.por_corretor.sort((a, b) => b.mensagens - a.mensagens)

        // Converte por_imobiliaria para array ordenado
        stats.por_imobiliaria = Object.values(stats.por_imobiliaria)
            .sort((a, b) => b.count - a.count)

        return res.json(stats)
    } catch (err) {
        return res.status(500).json({ erro: err.message })
    }
})

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))
})

app.post('/perguntar', async (req, res) => {
    res.setTimeout(28000, () => {
        return res.status(504).json({ erro: 'Timeout na requisicao' })
    })

    try {
        const { pergunta } = req.body
        if (!pergunta) return res.status(400).json({ erro: 'Envie uma pergunta' })

        console.log('Pergunta:', pergunta)
        const contexto = await buscarSupabase(pergunta)
        console.log('Contexto tamanho:', contexto.length)

        const resposta = await perguntarClaude('', '', [], contexto, pergunta)
        return res.json({ resposta })

    } catch (err) {
        console.error('Erro:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.post('/gerar-faq', async (req, res) => {
    try {
        console.log('Iniciando geração de FAQ...')

        // Busca todas as conversas com mensagens
        const { data: conversas, error } = await supabase
            .from('conversas')
            .select('nome, mensagens, resumo')
            .neq('mensagens', '[]')

        if (error || !conversas?.length) {
            return res.json({ status: 'nenhuma conversa encontrada' })
        }

        // Agrupa todas as perguntas dos corretores
        const todasPerguntas = []
        for (const conv of conversas) {
            const msgs = conv.mensagens || []
            for (const m of msgs) {
                if (m.role === 'user') todasPerguntas.push(m.content)
            }
            if (conv.resumo) todasPerguntas.push(`[resumo] ${conv.resumo}`)
        }

        if (!todasPerguntas.length) return res.json({ status: 'sem perguntas' })

        // Claude analisa e gera FAQ
        const analise = await claudeCreate({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            system: `Você analisa conversas de corretores imobiliários e gera um documento FAQ.
Identifique os temas mais frequentes e gere respostas baseadas nos padrões.
Formato de saída: título, perguntas agrupadas por tema com respostas diretas.
Use texto puro sem markdown.`,
            messages: [{
                role: 'user',
                content: `Analise essas perguntas e gere um FAQ:\n\n${todasPerguntas.slice(0, 200).join('\n')}`
            }]
        })

        const conteudoFaq = analise.content[0].text
        const nomeArquivo = `faq-gerado-${new Date().toISOString().slice(0, 10)}.txt`

        // Salva na tabela faq_gerado
        await supabase.from('faq_gerado').insert({ arquivo: nomeArquivo, conteudo: conteudoFaq })

        // Indexa no Supabase para a Bellinha usar
        const embedding = await gerarEmbedding(conteudoFaq.slice(0, 2000))
        await supabase.from('documentos').insert({
            arquivo: `faq/${nomeArquivo}`,
            conteudo: conteudoFaq,
            embedding
        })

        // Salva no GitHub como docs/faq-gerado.txt
        const githubToken = process.env.GITHUB_TOKEN
        const githubRepo = 'maykon2626-prog/notion-gpt-webhook'
        const githubPath = 'docs/faq-gerado.txt'
        // Busca SHA do arquivo atual (necessário para atualizar)
        const getRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${githubPath}`, {
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github+json' }
        })
        const getJson = await getRes.json()
        const sha = getRes.ok ? getJson.sha : null

        // Acumula conteúdo
        const conteudoAtual = sha ? Buffer.from(getJson.content, 'base64').toString('utf-8') : ''
        const novoConteudo = conteudoAtual
            ? `${conteudoAtual}\n\n---\n${new Date().toLocaleDateString('pt-BR')}\n${conteudoFaq}`
            : `${new Date().toLocaleDateString('pt-BR')}\n${conteudoFaq}`

        const putBody = {
            message: `FAQ atualizado ${new Date().toLocaleDateString('pt-BR')}`,
            content: Buffer.from(novoConteudo).toString('base64'),
            ...(sha && { sha })
        }

        const putRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${githubPath}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify(putBody)
        })

        const githubOk = putRes.ok
        console.log('GitHub save:', githubOk ? 'ok' : 'falhou')

        console.log('FAQ gerado e indexado:', nomeArquivo)
        return res.json({ status: 'ok', arquivo: nomeArquivo, github: githubOk })

    } catch (err) {
        console.error('Erro ao gerar FAQ:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.get('/debug', async (req, res) => {
    try {
        const voyageKey = process.env.VOYAGE_API_KEY
        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${voyageKey}`
            },
            body: JSON.stringify({ model: 'voyage-3-lite', input: 'teste' })
        })
        const data = await response.json()
        const embedding = response.ok ? data.data[0].embedding : null
        let supabase_result = null
        let supabase_error = null
        if (embedding) {
            const { data: sbData, error: sbError } = await supabase.rpc('buscar_similar', {
                query_embedding: embedding,
                match_count: 2
            })
            supabase_result = sbData?.length ?? 0
            supabase_error = sbError?.message ?? null
        }
        res.json({
            voyage_key_prefix: voyageKey?.slice(0, 8),
            voyage_status: response.status,
            voyage_ok: response.ok,
            supabase_key_length: process.env.SUPABASE_KEY?.length,
            supabase_key_prefix: process.env.SUPABASE_KEY?.slice(0, 15),
            supabase_resultados: supabase_result,
            supabase_error
        })
    } catch (err) {
        res.json({ erro: err.message })
    }
})

app.get('/', (req, res) => {
    res.json({ status: 'Bellinha rodando' })
})

process.on('uncaughtException', (err) => {
    console.error('Erro nao tratado:', err.message)
})

process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada:', reason)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log('Bellinha rodando na porta ' + PORT)
})

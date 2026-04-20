const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

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
        const response = await anthropic.messages.create({
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
            anthropic.messages.create({
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
                const extracaoNome = await anthropic.messages.create({
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
            const extracaoNome = await anthropic.messages.create({
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
            const extracao = await anthropic.messages.create({
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
        const analise = await anthropic.messages.create({
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

        console.log('FAQ gerado e indexado:', nomeArquivo)
        return res.json({ status: 'ok', arquivo: nomeArquivo })

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

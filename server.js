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

    if (error || !data) return { nome: '', tipo: '', resumo: '', mensagens: [] }
    return {
        nome: data.nome || '',
        tipo: data.tipo || '',
        resumo: data.resumo || '',
        mensagens: data.mensagens || []
    }
}

async function salvarConversa(numero, nome, tipo, resumo, mensagens) {
    const { error } = await supabase.from('conversas').upsert({
        numero,
        nome,
        tipo,
        resumo,
        mensagens,
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

async function perguntarClaude(nome, resumo, historico, contexto, pergunta) {
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

${resumo ? `RESUMO DO HISTÓRICO:\n${resumo}\n` : ''}
CONTEXTO DOS EMPREENDIMENTOS:
${contexto || 'Sem contexto disponível.'}`

        const response = await Promise.race([
            anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system,
                messages: [...historicoFormatado, { role: 'user', content: pergunta }]
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
                      msg?.data?.message?.extendedTextMessage?.text

        const numero = msg?.data?.key?.remoteJid
        const fromMe = msg?.data?.key?.fromMe

        if (!texto || !numero || fromMe) return res.sendStatus(200)

        console.log('WhatsApp - De:', numero)
        console.log('WhatsApp - Texto:', texto)

        let { nome, tipo, resumo, mensagens } = await carregarConversa(numero)

        // Primeira mensagem: pede o nome
        if (!nome) {
            if (mensagens.length === 0) {
                const boasVindas = 'Olá! 😊 Sou a Bellinha, assistente virtual da Bella Casa & Okada.\n\nAcho que a gente ainda não se conhece! Qual é o seu nome?'
                mensagens.push({ role: 'assistant', content: boasVindas })
                await salvarConversa(numero, '', '', '', mensagens)
                await enviarWhatsApp(numero, boasVindas)
                return res.sendStatus(200)
            }

            // Segunda mensagem: salva o nome e pergunta imobiliária
            nome = texto.trim()
            mensagens.push({ role: 'user', content: texto })
            const perguntaTipo = `Prazer, ${nome}! 😊 Você trabalha em alguma imobiliária? Se sim, qual? Ou é autônomo?`
            mensagens.push({ role: 'assistant', content: perguntaTipo })
            await salvarConversa(numero, nome, '', resumo, mensagens)
            await enviarWhatsApp(numero, perguntaTipo)
            return res.sendStatus(200)
        }

        // Terceira mensagem: salva imobiliária/autônomo
        if (!tipo) {
            const extracao = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 50,
                system: 'Extraia o vínculo profissional da mensagem. Responda APENAS em JSON: {"tipo": "..."}. Use "Autônomo" ou o nome da imobiliária. Se não identificar, use o texto original.',
                messages: [{ role: 'user', content: texto }]
            })

            try {
                const info = JSON.parse(extracao.content[0].text)
                tipo = info.tipo || texto.trim()
            } catch {
                tipo = texto.trim()
            }

            mensagens.push({ role: 'user', content: texto })
            const saudacao = `Anotado! 😊 ${tipo === 'Autônomo' ? 'Autônomo, ' : `Da ${tipo}, `}${nome}! Pode perguntar, estou aqui para te ajudar!`
            mensagens.push({ role: 'assistant', content: saudacao })
            await salvarConversa(numero, nome, tipo, resumo, mensagens)
            await enviarWhatsApp(numero, saudacao)
            return res.sendStatus(200)
        }

        // Busca contexto no Supabase
        const contexto = await buscarSupabase(texto)
        console.log('Contexto tamanho:', contexto.length)

        // Adiciona mensagem do usuário ao histórico
        mensagens.push({ role: 'user', content: texto })

        // Gera resposta com histórico
        const resposta = await perguntarClaude(nome, resumo, mensagens.slice(-30), contexto, texto)
        mensagens.push({ role: 'assistant', content: resposta })

        // Se atingiu 30 mensagens, gera resumo e limpa
        if (mensagens.length >= LIMITE_MENSAGENS) {
            console.log('Gerando resumo para', numero)
            resumo = await gerarResumo(nome, resumo, mensagens)
            mensagens = [] // limpa histórico após resumir
        }

        await salvarConversa(numero, nome, tipo, resumo, mensagens)
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

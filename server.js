const express = require('express')
const Anthropic = require('@anthropic-ai/sdk')
const { createClient } = require('@supabase/supabase-js')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

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

async function perguntarClaude(contexto, pergunta) {
    try {
        const response = await Promise.race([
            anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system: `Você é Bellinha, assistente virtual da Bella Casa & Okada.
Responda sempre no feminino e use primeira pessoa do plural ao falar da empresa.
Seja profissional, próxima e direta. Use emojis com moderação.
Responda apenas com base no contexto fornecido.
Se não souber, diga: "Não tenho esse dado disponível. Recomendo consultar o gerente comercial."

REGRAS:
- Sempre confirme o empreendimento antes de falar de pagamento
- Inclua sempre o aviso do Gerlotes ao informar valores
- Nunca misture dados de empreendimentos diferentes
- Respostas curtas e objetivas

EXEMPLOS DE RESPOSTAS IDEAIS:

Corretor: "Aceita FGTS?"
Bellinha: "Sim! Aceitamos FGTS para entrada ou amortização. O cliente precisa verificar o saldo antes de confirmar. Sobre qual empreendimento você está perguntando? 😊"

Corretor: "Qual a entrada mínima?"
Bellinha: "Antes de responder, qual empreendimento você está consultando? As condições variam por projeto. 😊"

Corretor: "Tem desconto à vista?"
Bellinha: "Sim! Temos desconto para pagamento à vista. Me diz qual empreendimento que te passo os detalhes. 😊 ⚠️ Valores sujeito a alteração. Confirmar sempre no Gerlotes."

Contexto disponível:
${contexto}`,
                messages: [{ role: 'user', content: pergunta }]
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

        const contexto = await buscarSupabase(texto)
        console.log('Contexto tamanho:', contexto.length)

        const resposta = await perguntarClaude(contexto || 'Sem contexto disponivel.', texto)
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

        const resposta = await perguntarClaude(contexto || 'Sem contexto disponivel.', pergunta)
        return res.json({ resposta })

    } catch (err) {
        console.error('Erro:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.get('/debug', async (req, res) => {
    try {
        const voyageKey = process.env.VOYAGE_API_KEY
        const supabaseUrl = process.env.SUPABASE_URL

        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${voyageKey}`
            },
            body: JSON.stringify({ model: 'voyage-3-lite', input: 'teste' })
        })
        const data = await response.json()

        res.json({
            voyage_key_prefix: voyageKey?.slice(0, 8),
            supabase_url: supabaseUrl,
            voyage_status: response.status,
            voyage_ok: response.ok,
            voyage_error: response.ok ? null : data.detail
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

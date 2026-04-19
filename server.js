const express = require('express')
const { Client } = require('@notionhq/client')
const Anthropic = require('@anthropic-ai/sdk')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function extrairTexto(pageId, profundidade = 0) {
    if (profundidade > 2) return ''

    try {
        const blocks = await notion.blocks.children.list({ block_id: pageId })
        const comTexto = [
            'paragraph', 'heading_1', 'heading_2', 'heading_3',
            'bulleted_list_item', 'numbered_list_item',
            'quote', 'callout', 'toggle', 'to_do'
        ]

        let textos = []

        for (const b of blocks.results) {
            const tipo = b.type

            if (comTexto.includes(tipo)) {
                const texto = b[tipo]?.rich_text?.map(t => t.plain_text).join('') || ''
                if (texto) textos.push(texto)
            }

            if (tipo === 'child_page') {
                console.log('Entrando na subpagina:', b.child_page.title)
                const sub = await extrairTexto(b.id, profundidade + 1)
                if (sub) textos.push('\n## ' + b.child_page.title + '\n' + sub)
            }

            if (tipo === 'child_database') {
                console.log('Lendo database:', b.child_database.title)
                try {
                    const db = await notion.databases.query({ database_id: b.id })
                    for (const item of db.results) {
                        const titulo = item.properties?.Name?.title?.[0]?.plain_text ||
                                      item.properties?.titulo?.title?.[0]?.plain_text || ''
                        const conteudoItem = await extrairTexto(item.id, profundidade + 1)
                        if (titulo || conteudoItem) {
                            textos.push('\n### ' + titulo + '\n' + conteudoItem)
                        }
                    }
                } catch (dbErr) {
                    console.error('Erro ao ler database:', dbErr.message)
                }
            }

            if (b.has_children && tipo !== 'child_page' && tipo !== 'child_database') {
                const filhos = await extrairTexto(b.id, profundidade + 1)
                if (filhos) textos.push(filhos)
            }
        }

        return textos.join('\n')

    } catch (err) {
        console.error('Erro ao extrair texto:', err.message)
        return ''
    }
}

async function perguntarClaude(contexto, pergunta) {
    try {
        const response = await Promise.race([
            anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                system: `Você é Bellinha, assistente virtual da Bella Casa & Okada.
Responda sempre no feminino e use primeira pessoa do plural ao falar da empresa.
Responda apenas com base no contexto fornecido.
Se não souber, diga: "Não tenho esse dado disponível. Recomendo consultar o gerente comercial."
Contexto disponível:
${contexto}`,
                messages: [
                    { role: 'user', content: pergunta }
                ]
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

app.get('/search', async (req, res) => {
    try {
        const query = req.query.query
        if (!query) return res.status(400).json({ erro: 'Envie um campo query' })
        const result = await notion.search({
            query: query,
            filter: { property: 'object', value: 'page' }
        })
        if (result.results.length === 0) return res.status(404).json({ erro: 'Nenhuma pagina encontrada' })
        const page = result.results[0]
        const contexto = await extrairTexto(page.id)
        return res.json({
            pagina: page.id,
            titulo: page.properties?.title?.title?.[0]?.plain_text || 'sem titulo',
            conteudo: contexto
        })
    } catch (err) {
        console.error('Erro na busca:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.post('/webhook', async (req, res) => {
    try {
        const { pageId } = req.body
        if (!pageId) return res.status(400).json({ erro: 'Envie pageId no body' })
        const conteudo = await extrairTexto(pageId)
        if (!conteudo) return res.status(404).json({ erro: 'Pagina sem conteudo' })
        return res.json({ conteudo })
    } catch (err) {
        console.error('Erro no webhook:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.post('/perguntar', async (req, res) => {
    res.setTimeout(28000, () => {
        console.log('TIMEOUT na requisicao')
        return res.status(504).json({ erro: 'Timeout na requisicao' })
    })

    try {
        const { pergunta, query } = req.body
        console.log('1. Pergunta recebida:', pergunta)
        console.log('2. Query:', query)

        if (!pergunta) return res.status(400).json({ erro: 'Envie uma pergunta' })

        let contexto = 'Sem contexto disponivel.'

        if (query) {
            console.log('3. Buscando no Notion...')
            try {
                const result = await notion.search({
                    query: query,
                    filter: { property: 'object', value: 'page' }
                })
                console.log('4. Notion retornou:', result.results.length, 'paginas')
                if (result.results.length > 0) {
                    const page = result.results[0]
                    console.log('5. Extraindo texto da pagina:', page.id)
                    contexto = await extrairTexto(page.id)
                    console.log('6. Texto extraido, tamanho:', contexto.length)
                }
            } catch (notionErr) {
                console.error('ERRO no Notion:', notionErr.message)
            }
        }

        console.log('7. Chamando Claude...')
        const resposta = await perguntarClaude(contexto, pergunta)
        console.log('8. Claude respondeu!')

        return res.json({ resposta })

    } catch (err) {
        console.error('ERRO GERAL:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.post('/whatsapp', async (req, res) => {
    try {
        const msg = req.body

        const texto = msg?.data?.message?.conversation ||
                      msg?.data?.message?.extendedTextMessage?.text

        const numero = msg?.data?.key?.remoteJid

        if (!texto || !numero) return res.sendStatus(200)

        console.log('WhatsApp - De:', numero)
        console.log('WhatsApp - Texto:', texto)

        let contexto = 'Sem contexto disponivel.'
        try {
            const result = await notion.search({
                query: texto,
                filter: { property: 'object', value: 'page' }
            })
            if (result.results.length > 0) {
                contexto = await extrairTexto(result.results[0].id)
            }
        } catch (notionErr) {
            console.error('ERRO Notion no WhatsApp:', notionErr.message)
        }

        const resposta = await perguntarClaude(contexto, texto)
        await enviarWhatsApp(numero, resposta)

        return res.sendStatus(200)

    } catch (err) {
        console.error('Erro no WhatsApp:', err.message)
        return res.sendStatus(200)
    }
})

app.get('/', (req, res) => {
    res.json({ status: 'Webhook rodando' })
})

process.on('uncaughtException', (err) => {
    console.error('Erro nao tratado:', err.message)
})

process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada:', reason)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log('Webhook rodando na porta ' + PORT)
})

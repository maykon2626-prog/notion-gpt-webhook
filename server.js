const express = require('express')
const { Client } = require('@notionhq/client')
const Anthropic = require('@anthropic-ai/sdk')

const app = express()
app.use(express.json())

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function buscarPagina(pageId) {
    try {
        const page = await notion.pages.retrieve({ page_id: pageId })
        return page
    } catch (err) {
        console.error('Erro ao buscar pagina:', err.message)
        return null
    }
}

async function extrairTexto(page) {
    try {
        const blocks = await notion.blocks.children.list({ block_id: page.id })
        const textos = blocks.results.map(b => {
            const tipo = b.type
            const comTexto = [
                'paragraph', 'heading_1', 'heading_2', 'heading_3',
                'bulleted_list_item', 'numbered_list_item',
                'quote', 'callout', 'toggle', 'to_do'
            ]
            if (comTexto.includes(tipo)) {
                return b[tipo]?.rich_text?.map(t => t.plain_text).join('') || ''
            }
            if (tipo === 'code') {
                return b.code?.rich_text?.map(t => t.plain_text).join('') || ''
            }
            return ''
        })
        return textos.filter(Boolean).join('\n')
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

app.get('/search', async (req, res) => {
    try {
        const query = req.query.query
        if (!query) {
            return res.status(400).json({ erro: 'Envie um campo query' })
        }
        console.log('Buscando no Notion:', query)
        const result = await notion.search({
            query: query,
            filter: { property: 'object', value: 'page' }
        })
        if (result.results.length === 0) {
            return res.status(404).json({ erro: 'Nenhuma pagina encontrada' })
        }
        const page = result.results[0]
        const contexto = await extrairTexto(page)
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
        if (!pageId) {
            return res.status(400).json({ erro: 'Envie pageId no body' })
        }
        const page = await buscarPagina(pageId)
        if (!page) {
            return res.status(404).json({ erro: 'Pagina nao encontrada' })
        }
        const conteudo = await extrairTexto(page)
        if (!conteudo) {
            return res.status(404).json({ erro: 'Pagina sem conteudo' })
        }
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

        if (!pergunta) {
            return res.status(400).json({ erro: 'Envie uma pergunta' })
        }

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
                    contexto = await extrairTexto(page)
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

const express = require('express')
const { Client } = require('@notionhq/client')

const app = express()
app.use(express.json())

const notion = new Client({ auth: process.env.NOTION_TOKEN })

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
        return blocks.results
            .map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join('') || '')
            .filter(Boolean)
            .join('\n')
    } catch (err) {
        console.error('Erro ao extrair texto:', err.message)
        return ''
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

        const blocks = await notion.blocks.children.list({ block_id: page.id })
        const conteudo = blocks.results
            .map(b => b[b.type]?.rich_text?.map(t => t.plain_text).join('') || '')
            .filter(Boolean)
            .join('\n')

        return res.json({
            pagina: page.id,
            titulo: page.properties?.title?.title?.[0]?.plain_text || 'sem titulo',
            conteudo: conteudo
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

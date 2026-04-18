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
        console.error('Erro ao buscar página:', err.message)
        return null
    }
}

async function buscarDatabase(databaseId, filtro = {}) {
    try {
        const result = await notion.databases.query({
            database_id: databaseId,
            filter: filtro
        })
        return result.results
    } catch (err) {
        console.error('Erro ao buscar database:', err.message)
        return []
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

app.post('/webhook', async (req, res) => {
    try {
        const { pergunta, pageId, databaseId } = req.body
        console.log('Pergunta recebida:', pergunta)

        let conteudo = ''

        if (pageId) {
            const page = await buscarPagina(pageId)
            if (page) conteudo = await extrairTexto(page)
        } else if (databaseId) {
            const itens = await buscarDatabase(databaseId)
            conteudo = JSON.stringify(itens, null, 2)
        } else {
            return res.status(400).json({ erro: 'Envie pageId ou databaseId no body' })
        }

        if (!conteudo) {
            return res.status(404).json({ erro: 'Página não encontrada ou sem conteúdo' })
        }

        return res.json({ conteudo })

    } catch (err) {
        console.error('Erro no webhook:', err.message)
        return res.status(500).json({ erro: err.message })
    }
})

app.get('/', (req, res) => {
    res.json({ status: 'Webhook rodando ✅' })
})

process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err.message)
})

process.on('unhandledRejection', (reason) => {
    console.error('Promise rejeitada:', reason)
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log('✅ Webhook rodando na porta ' + PORT)
})

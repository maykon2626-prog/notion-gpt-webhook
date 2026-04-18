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
        const response = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            system: `Você é Bellinha, assistente virtual da Bella Casa & Okada.
Responda sempre no feminino e use primeira pessoa do plural ao falar da empresa.
Responda apenas com base no contexto fornecido.
Se não souber, diga: "Não tenho esse dado disponível. Recomendo consultar o gerente comercial."
Contexto disponível:
${contexto}`,
            messages: [
                { role: 'user', content: pergunta }
            ]
        })
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

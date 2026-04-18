const { Client } = require('@notionhq/client')
const notion = new Client({ auth: process.env.NOTION_TOKEN })

async function buscarPagina(pageId) {
    try {
        // Para páginas normais
        const page = await notion.pages.retrieve({ page_id: pageId })
        return page

    } catch (err) {
        console.error('Erro ao buscar página:', err.message)
        return null
    }
}

async function buscarDatabase(databaseId, filtro = {}) {
    try {
        // Para databases (tabelas)
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

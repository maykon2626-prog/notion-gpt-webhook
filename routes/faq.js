const express = require('express')
const router = express.Router()

const { supabase } = require('../lib/supabase')
const { claudeCreate } = require('../lib/claude')
const { gerarEmbedding } = require('../lib/rag')

router.post('/', async (req, res) => {
    try {
        console.log('Iniciando geração de FAQ...')

        const { data: conversas, error } = await supabase
            .from('conversas')
            .select('nome, mensagens, resumo')
            .neq('mensagens', '[]')

        if (error || !conversas?.length) {
            return res.json({ status: 'nenhuma conversa encontrada' })
        }

        const todasPerguntas = []
        for (const conv of conversas) {
            const msgs = conv.mensagens || []
            for (const m of msgs) {
                if (m.role === 'user') todasPerguntas.push(m.content)
            }
            if (conv.resumo) todasPerguntas.push(`[resumo] ${conv.resumo}`)
        }

        if (!todasPerguntas.length) return res.json({ status: 'sem perguntas' })

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

        await supabase.from('faq_gerado').insert({ arquivo: nomeArquivo, conteudo: conteudoFaq })

        const embedding = await gerarEmbedding(conteudoFaq.slice(0, 2000))
        await supabase.from('documentos').insert({
            arquivo: `faq/${nomeArquivo}`,
            conteudo: conteudoFaq,
            embedding
        })

        const githubToken = process.env.GITHUB_TOKEN
        const githubRepo = 'maykon2626-prog/notion-gpt-webhook'
        const githubPath = 'docs/faq-gerado.txt'
        const getRes = await fetch(`https://api.github.com/repos/${githubRepo}/contents/${githubPath}`, {
            headers: { 'Authorization': `Bearer ${githubToken}`, 'Accept': 'application/vnd.github+json' }
        })
        const getJson = await getRes.json()
        const sha = getRes.ok ? getJson.sha : null

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

module.exports = router

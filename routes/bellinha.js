const express = require('express')
const router = express.Router()
const { supabase } = require('../lib/supabase')
const { gerarEmbedding } = require('../lib/rag')
const { validarSessao } = require('./auth')

async function autenticar(req, res, next) {
    if (!await validarSessao(req.headers['x-token'])) {
        return res.status(401).json({ erro: 'Não autorizado' })
    }
    next()
}

function dividirTexto(texto, tamanho = 400) {
    const paragrafos = texto.split('\n\n').filter(Boolean)
    const pedacos = []
    let atual = ''
    for (const p of paragrafos) {
        if ((atual + p).split(' ').length > tamanho) {
            if (atual) pedacos.push(atual.trim())
            atual = p
        } else {
            atual += (atual ? '\n\n' : '') + p
        }
    }
    if (atual) pedacos.push(atual.trim())
    return pedacos.length ? pedacos : [texto.trim()]
}

// ── Instruções ───────────────────────────────────

router.get('/instrucoes', autenticar, async (req, res) => {
    const { data } = await supabase
        .from('bellinha_config')
        .select('valor')
        .eq('chave', 'instrucoes')
        .single()
    return res.json({ instrucoes: data?.valor || '' })
})

router.put('/instrucoes', autenticar, async (req, res) => {
    const { instrucoes } = req.body
    if (!instrucoes?.trim()) return res.status(400).json({ erro: 'Instruções não podem estar vazias' })
    const { error } = await supabase
        .from('bellinha_config')
        .upsert({ chave: 'instrucoes', valor: instrucoes.trim() }, { onConflict: 'chave' })
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

// ── Docs de treinamento ──────────────────────────

router.get('/docs', autenticar, async (req, res) => {
    const { data, error } = await supabase
        .from('documentos')
        .select('id, arquivo, conteudo')
        .order('arquivo')
    if (error) return res.status(500).json({ erro: error.message })

    // Agrupa por arquivo, retorna resumo por doc
    const mapa = {}
    for (const row of data || []) {
        if (!mapa[row.arquivo]) mapa[row.arquivo] = { arquivo: row.arquivo, chunks: 0, preview: '' }
        mapa[row.arquivo].chunks++
        if (!mapa[row.arquivo].preview) mapa[row.arquivo].preview = row.conteudo.slice(0, 120)
    }
    return res.json(Object.values(mapa))
})

router.post('/docs', autenticar, async (req, res) => {
    const { titulo, conteudo } = req.body
    if (!titulo?.trim()) return res.status(400).json({ erro: 'Título obrigatório' })
    if (!conteudo?.trim()) return res.status(400).json({ erro: 'Conteúdo obrigatório' })

    const nomeArquivo = `dashboard/${titulo.trim().replace(/[^a-zA-Z0-9\-_. ]/g, '').trim()}.txt`

    // Remove chunks antigos do mesmo arquivo se já existir
    await supabase.from('documentos').delete().eq('arquivo', nomeArquivo)

    const pedacos = dividirTexto(conteudo)
    const erros = []

    for (let i = 0; i < pedacos.length; i++) {
        try {
            if (i > 0) await new Promise(r => setTimeout(r, 1200)) // respeita rate limit Voyage
            const embedding = await gerarEmbedding(pedacos[i])
            const { error } = await supabase
                .from('documentos')
                .insert({ arquivo: nomeArquivo, conteudo: pedacos[i], embedding })
            if (error) erros.push(`chunk ${i + 1}: ${error.message}`)
        } catch (err) {
            erros.push(`chunk ${i + 1}: ${err.message}`)
        }
    }

    if (erros.length === pedacos.length) return res.status(500).json({ erro: 'Falha ao indexar: ' + erros[0] })
    return res.json({ ok: true, chunks: pedacos.length - erros.length, erros })
})

router.delete('/docs/:arquivo(*)', autenticar, async (req, res) => {
    const { error } = await supabase
        .from('documentos')
        .delete()
        .eq('arquivo', decodeURIComponent(req.params.arquivo))
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

module.exports = router

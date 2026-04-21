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

function sanitizarNome(str) {
    return str.trim().replace(/[\/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
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

async function indexarArquivo(nomeArquivo, conteudo) {
    await supabase.from('documentos').delete().eq('arquivo', nomeArquivo)
    const pedacos = dividirTexto(conteudo)
    const erros = []
    for (let i = 0; i < pedacos.length; i++) {
        try {
            if (i > 0) await new Promise(r => setTimeout(r, 1200))
            const embedding = await gerarEmbedding(pedacos[i])
            const { error } = await supabase.from('documentos').insert({ arquivo: nomeArquivo, conteudo: pedacos[i], embedding })
            if (error) erros.push(`chunk ${i + 1}: ${error.message}`)
        } catch (err) {
            erros.push(`chunk ${i + 1}: ${err.message}`)
        }
    }
    return { chunks: pedacos.length - erros.length, erros }
}

// ── Instruções ───────────────────────────────────

router.get('/instrucoes', autenticar, async (req, res) => {
    const { data } = await supabase.from('bellinha_config').select('valor').eq('chave', 'instrucoes').single()
    return res.json({ instrucoes: data?.valor || '' })
})

router.put('/instrucoes', autenticar, async (req, res) => {
    const { instrucoes } = req.body
    if (!instrucoes?.trim()) return res.status(400).json({ erro: 'Instruções não podem estar vazias' })
    const { error } = await supabase.from('bellinha_config').upsert({ chave: 'instrucoes', valor: instrucoes.trim() }, { onConflict: 'chave' })
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

// ── Docs — listagem com estrutura de pastas ──────

router.get('/docs', autenticar, async (req, res) => {
    const { data, error } = await supabase.from('documentos').select('id, arquivo, conteudo').order('arquivo')
    if (error) return res.status(500).json({ erro: error.message })

    const mapa = {}
    for (const row of data || []) {
        if (!mapa[row.arquivo]) mapa[row.arquivo] = { arquivo: row.arquivo, chunks: 0, preview: '' }
        mapa[row.arquivo].chunks++
        if (!mapa[row.arquivo].preview) mapa[row.arquivo].preview = row.conteudo.slice(0, 100)
    }

    // Monta estrutura de pastas
    const pastas = {}
    for (const doc of Object.values(mapa)) {
        const partes = doc.arquivo.split('/')
        const pasta = partes.length > 1 ? partes.slice(0, -1).join('/') : '(raiz)'
        const nome = partes[partes.length - 1].replace(/\.txt$/, '')
        if (!pastas[pasta]) pastas[pasta] = []
        pastas[pasta].push({ ...doc, nome })
    }

    return res.json(pastas)
})

// ── Docs — conteúdo completo de um arquivo ───────

router.get('/docs/conteudo', autenticar, async (req, res) => {
    const arquivo = req.query.arquivo
    if (!arquivo) return res.status(400).json({ erro: 'Parâmetro arquivo obrigatório' })
    const { data, error } = await supabase.from('documentos').select('conteudo').eq('arquivo', arquivo).order('id')
    if (error) return res.status(500).json({ erro: error.message })
    if (!data?.length) return res.status(404).json({ erro: 'Documento não encontrado' })
    return res.json({ conteudo: data.map(r => r.conteudo).join('\n\n') })
})

// ── Docs — criar ─────────────────────────────────

router.post('/docs', autenticar, async (req, res) => {
    const { pasta, titulo, conteudo } = req.body
    if (!titulo?.trim()) return res.status(400).json({ erro: 'Título obrigatório' })
    if (!conteudo?.trim()) return res.status(400).json({ erro: 'Conteúdo obrigatório' })

    const nomePasta = pasta?.trim() ? sanitizarNome(pasta) : null
    const nomeTitulo = sanitizarNome(titulo) + '.txt'
    const nomeArquivo = nomePasta ? `${nomePasta}/${nomeTitulo}` : nomeTitulo

    const resultado = await indexarArquivo(nomeArquivo, conteudo)
    if (resultado.chunks === 0) return res.status(500).json({ erro: 'Falha ao indexar: ' + resultado.erros[0] })
    return res.json({ ok: true, arquivo: nomeArquivo, ...resultado })
})

// ── Docs — editar (re-indexar) ───────────────────

router.put('/docs/conteudo', autenticar, async (req, res) => {
    const { arquivo, conteudo } = req.body
    if (!arquivo?.trim()) return res.status(400).json({ erro: 'arquivo obrigatório' })
    if (!conteudo?.trim()) return res.status(400).json({ erro: 'Conteúdo obrigatório' })
    const resultado = await indexarArquivo(arquivo, conteudo)
    if (resultado.chunks === 0) return res.status(500).json({ erro: 'Falha ao indexar: ' + resultado.erros[0] })
    return res.json({ ok: true, ...resultado })
})

// ── Docs — renomear arquivo ou pasta ────────────

router.post('/docs/renomear', autenticar, async (req, res) => {
    const { de, para, tipo } = req.body   // tipo: 'doc' | 'pasta'
    if (!de?.trim() || !para?.trim()) return res.status(400).json({ erro: 'Campos de e para obrigatórios' })

    if (tipo === 'pasta') {
        const { data, error } = await supabase.from('documentos').select('id, arquivo').like('arquivo', `${de}/%`)
        if (error) return res.status(500).json({ erro: error.message })
        for (const row of data || []) {
            const novoArquivo = para + row.arquivo.slice(de.length)
            await supabase.from('documentos').update({ arquivo: novoArquivo }).eq('id', row.id)
        }
    } else {
        await supabase.from('documentos').update({ arquivo: para }).eq('arquivo', de)
    }
    return res.json({ ok: true })
})

// ── Docs — deletar arquivo ou pasta ─────────────

router.delete('/docs/pasta/:pasta(*)', autenticar, async (req, res) => {
    const pasta = decodeURIComponent(req.params.pasta)
    const { error } = await supabase.from('documentos').delete().like('arquivo', `${pasta}/%`)
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

router.delete('/docs/:arquivo(*)', autenticar, async (req, res) => {
    const { error } = await supabase.from('documentos').delete().eq('arquivo', decodeURIComponent(req.params.arquivo))
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

module.exports = router

const express = require('express')
const router = express.Router()
const { supabase } = require('../lib/supabase')
const { validarSessao } = require('./auth')

async function autenticar(req, res, next) {
    if (!await validarSessao(req.headers['x-token'])) {
        return res.status(401).json({ erro: 'Não autorizado' })
    }
    next()
}

// ── Leads ─────────────────────────────────────────

router.get('/leads', autenticar, async (req, res) => {
    const { data, error } = await supabase
        .from('crm_leads')
        .select('*')
        .order('criado_em', { ascending: false })
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.post('/leads', autenticar, async (req, res) => {
    const b = req.body
    if (!b.nome) return res.status(400).json({ erro: 'Nome obrigatório' })
    const { data, error } = await supabase
        .from('crm_leads')
        .insert({
            nome: b.nome,
            telefone: b.telefone || null,
            email: b.email || null,
            coluna: b.coluna || 'novo',
            arquivado: false,
            corretor: b.corretor || null,
            corretor_numero: b.corretor_numero || null,
            produto_negociacao: b.produto_negociacao || null,
            produto_origem: b.produto_origem || null,
            campanha_origem: b.campanha_origem || null,
            valor_negociacao: b.valor_negociacao || null,
            status_venda: b.status_venda || null,
            motivo_perda: b.motivo_perda || null,
            data_cadastro: b.data_cadastro || new Date().toISOString(),
            data_ultimo_contato: b.data_ultimo_contato || null,
            documentos: b.documentos || null,
            anotacoes: b.anotacoes || null,
        })
        .select()
        .single()
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(201).json(data)
})

router.put('/leads/:id', autenticar, async (req, res) => {
    const { id } = req.params
    const b = req.body
    const payload = { atualizado_em: new Date().toISOString() }
    const fields = [
        'nome','telefone','email','coluna','arquivado','corretor','corretor_numero',
        'produto_negociacao','produto_origem','campanha_origem','valor_negociacao',
        'status_venda','motivo_perda','data_cadastro','data_ultimo_contato',
        'documentos','anotacoes'
    ]
    fields.forEach(f => { if (f in b) payload[f] = b[f] || null })
    const { data, error } = await supabase
        .from('crm_leads').update(payload).eq('id', id).select().single()
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.delete('/leads/:id', autenticar, async (req, res) => {
    const { error } = await supabase.from('crm_leads').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

// ── Empreendimentos ───────────────────────────────

router.get('/empreendimentos', autenticar, async (req, res) => {
    const { data, error } = await supabase
        .from('empreendimentos')
        .select('*')
        .order('nome')
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.post('/empreendimentos', autenticar, async (req, res) => {
    const { nome, tipo, status } = req.body
    if (!nome) return res.status(400).json({ erro: 'Nome obrigatório' })
    const { data, error } = await supabase
        .from('empreendimentos')
        .insert({ nome, tipo: tipo || null, status: status || null })
        .select()
        .single()
    if (error) return res.status(500).json({ erro: error.message })
    return res.status(201).json(data)
})

router.delete('/empreendimentos/:id', autenticar, async (req, res) => {
    const { error } = await supabase.from('empreendimentos').delete().eq('id', req.params.id)
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

module.exports = router

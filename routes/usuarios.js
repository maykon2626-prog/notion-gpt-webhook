const express = require('express')
const router = express.Router()
const { supabase } = require('../lib/supabase')
const { validarSessao } = require('./auth')

function autenticar(req, res, next) {
    if (!validarSessao(req.headers['x-token'])) {
        return res.status(401).json({ erro: 'Não autorizado' })
    }
    next()
}

function normalizar(numero) {
    const digits = numero.replace(/\D/g, '')
    return digits.startsWith('55') ? digits.slice(2) : digits
}

router.get('/', autenticar, async (req, res) => {
    const { data, error } = await supabase
        .from('dashboard_usuarios')
        .select('*')
        .order('criado_em', { ascending: true })
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.post('/', autenticar, async (req, res) => {
    const { numero, nome } = req.body
    if (!numero) return res.status(400).json({ erro: 'Número obrigatório' })
    const num = normalizar(numero)
    const { data, error } = await supabase
        .from('dashboard_usuarios')
        .insert({ numero: num, nome: nome || null })
        .select()
        .single()
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.delete('/:numero', autenticar, async (req, res) => {
    const { error } = await supabase
        .from('dashboard_usuarios')
        .delete()
        .eq('numero', req.params.numero)
    if (error) return res.status(500).json({ erro: error.message })
    return res.json({ ok: true })
})

module.exports = router

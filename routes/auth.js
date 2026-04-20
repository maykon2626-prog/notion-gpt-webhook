const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { enviarWhatsApp } = require('../lib/whatsapp')
const { supabase } = require('../lib/supabase')

// numero -> { codigo, expira }
const codigosRecuperacao = new Map()

// token -> { numero, expira }
const sessoes = new Map()

function normalizar(numero) {
    const digits = numero.replace(/\D/g, '')
    return digits.startsWith('55') ? digits.slice(2) : digits
}

function paraWhatsApp(numero) {
    return '55' + numero + '@s.whatsapp.net'
}

// ── Login com senha ──────────────────────────────

router.post('/login', async (req, res) => {
    const { numero, senha } = req.body
    if (!numero || !senha) return res.status(400).json({ erro: 'Dados incompletos' })

    const num = normalizar(numero)
    const { data: usuario } = await supabase
        .from('dashboard_usuarios')
        .select('*')
        .eq('numero', num)
        .eq('ativo', true)
        .single()

    if (!usuario) return res.status(401).json({ erro: 'Número ou senha incorretos' })
    if (!usuario.senha_hash) return res.status(401).json({ erro: 'Senha não configurada. Use "Esqueci minha senha" para definir.' })

    const ok = await bcrypt.compare(senha, usuario.senha_hash)
    if (!ok) return res.status(401).json({ erro: 'Número ou senha incorretos' })

    const token = crypto.randomBytes(32).toString('hex')
    sessoes.set(token, { numero: num, expira: Date.now() + 8 * 60 * 60 * 1000 })

    return res.json({ token, nome: usuario.nome })
})

// ── Recuperação de senha via WhatsApp ────────────

router.post('/recuperar/solicitar', async (req, res) => {
    const { numero } = req.body
    if (!numero) return res.status(400).json({ erro: 'Número obrigatório' })

    const num = normalizar(numero)
    const { data: usuario } = await supabase
        .from('dashboard_usuarios')
        .select('id')
        .eq('numero', num)
        .eq('ativo', true)
        .single()

    if (!usuario) return res.json({ ok: true }) // não revela se número existe

    const codigo = String(Math.floor(100000 + Math.random() * 900000))
    codigosRecuperacao.set(num, { codigo, expira: Date.now() + 5 * 60 * 1000 })

    await enviarWhatsApp(paraWhatsApp(num),
        `🔐 Código para redefinir sua senha do Dashboard Bellinha:\n\n*${codigo}*\n\nVálido por 5 minutos.`)

    return res.json({ ok: true })
})

router.post('/recuperar/redefinir', async (req, res) => {
    const { numero, codigo, nova_senha } = req.body
    if (!numero || !codigo || !nova_senha) return res.status(400).json({ erro: 'Dados incompletos' })
    if (nova_senha.length < 6) return res.status(400).json({ erro: 'Senha deve ter pelo menos 6 caracteres' })

    const num = normalizar(numero)
    const pendente = codigosRecuperacao.get(num)
    if (!pendente) return res.status(401).json({ erro: 'Nenhum código solicitado' })
    if (Date.now() > pendente.expira) {
        codigosRecuperacao.delete(num)
        return res.status(401).json({ erro: 'Código expirado. Solicite um novo.' })
    }
    if (pendente.codigo !== codigo.trim()) return res.status(401).json({ erro: 'Código incorreto' })

    codigosRecuperacao.delete(num)
    const hash = await bcrypt.hash(nova_senha, 10)
    await supabase.from('dashboard_usuarios').update({ senha_hash: hash }).eq('numero', num)

    return res.json({ ok: true })
})

// ── Trocar senha (autenticado) ───────────────────

router.post('/trocar-senha', async (req, res) => {
    const token = req.headers['x-token']
    if (!validarSessao(token)) return res.status(401).json({ erro: 'Não autorizado' })

    const { senha_atual, nova_senha } = req.body
    if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Dados incompletos' })
    if (nova_senha.length < 6) return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 6 caracteres' })

    const { numero } = sessoes.get(token)
    const { data: usuario } = await supabase
        .from('dashboard_usuarios')
        .select('senha_hash')
        .eq('numero', numero)
        .single()

    const ok = await bcrypt.compare(senha_atual, usuario.senha_hash)
    if (!ok) return res.status(401).json({ erro: 'Senha atual incorreta' })

    const hash = await bcrypt.hash(nova_senha, 10)
    await supabase.from('dashboard_usuarios').update({ senha_hash: hash }).eq('numero', numero)

    return res.json({ ok: true })
})

function validarSessao(token) {
    if (!token) return false
    const sessao = sessoes.get(token)
    if (!sessao) return false
    if (Date.now() > sessao.expira) { sessoes.delete(token); return false }
    return true
}

module.exports = { router, validarSessao }

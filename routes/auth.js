const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const rateLimit = require('express-rate-limit')
const { enviarWhatsApp } = require('../lib/whatsapp')
const { supabase } = require('../lib/supabase')

// numero -> { codigo, expira }
const codigosRecuperacao = new Map()

function normalizar(numero) {
    const digits = numero.replace(/\D/g, '')
    return digits.startsWith('55') ? digits.slice(2) : digits
}

function paraWhatsApp(numero) {
    return '55' + numero + '@s.whatsapp.net'
}

// ── Rate limiters ────────────────────────────────

const limiteLogin = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Aguarde 15 minutos.' }
})

const limiteRecuperacao = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas solicitações. Aguarde 1 hora.' }
})

// ── Sessões no Supabase ──────────────────────────

async function criarSessao(numero) {
    const token = crypto.randomBytes(32).toString('hex')
    const expira = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    await supabase.from('dashboard_sessoes').insert({ token, numero, expira })
    return token
}

async function validarSessao(token) {
    if (!token) return false
    const { data } = await supabase
        .from('dashboard_sessoes')
        .select('numero, expira')
        .eq('token', token)
        .single()
    if (!data) return false
    if (new Date() > new Date(data.expira)) {
        await supabase.from('dashboard_sessoes').delete().eq('token', token)
        return false
    }
    return true
}

async function getSessaoNumero(token) {
    const { data } = await supabase
        .from('dashboard_sessoes')
        .select('numero')
        .eq('token', token)
        .single()
    return data?.numero || null
}

async function deletarSessao(token) {
    await supabase.from('dashboard_sessoes').delete().eq('token', token)
}

// ── Login com senha ──────────────────────────────

router.post('/login', limiteLogin, async (req, res) => {
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

    const token = await criarSessao(num)
    return res.json({ token, nome: usuario.nome })
})

// ── Recuperação de senha via WhatsApp ────────────

router.post('/recuperar/solicitar', limiteRecuperacao, async (req, res) => {
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

router.post('/recuperar/redefinir', limiteRecuperacao, async (req, res) => {
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
    if (!await validarSessao(token)) return res.status(401).json({ erro: 'Não autorizado' })

    const { senha_atual, nova_senha } = req.body
    if (!senha_atual || !nova_senha) return res.status(400).json({ erro: 'Dados incompletos' })
    if (nova_senha.length < 6) return res.status(400).json({ erro: 'Nova senha deve ter pelo menos 6 caracteres' })

    const numero = await getSessaoNumero(token)
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

// ── Logout ───────────────────────────────────────

router.post('/logout', async (req, res) => {
    const token = req.headers['x-token']
    if (token) await deletarSessao(token)
    return res.json({ ok: true })
})

module.exports = { router, validarSessao }

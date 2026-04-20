const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { enviarWhatsApp } = require('../lib/whatsapp')

const NUMEROS_AUTORIZADOS = (process.env.DASHBOARD_NUMEROS || '45998388220')
    .split(',').map(n => n.replace(/\D/g, '').trim())

// numero -> { codigo, expira }
const codigosPendentes = new Map()

// token -> { numero, expira }
const sessoes = new Map()

function normalizar(numero) {
    const digits = numero.replace(/\D/g, '')
    return digits.startsWith('55') ? digits.slice(2) : digits
}

function paraWhatsApp(numero) {
    return '55' + numero + '@s.whatsapp.net'
}

router.post('/solicitar-codigo', async (req, res) => {
    const { numero } = req.body
    if (!numero) return res.status(400).json({ erro: 'Número obrigatório' })

    const num = normalizar(numero)
    if (!NUMEROS_AUTORIZADOS.includes(num)) {
        return res.status(403).json({ erro: 'Número não autorizado' })
    }

    const codigo = String(Math.floor(100000 + Math.random() * 900000))
    codigosPendentes.set(num, { codigo, expira: Date.now() + 5 * 60 * 1000 })

    await enviarWhatsApp(paraWhatsApp(num),
        `🔐 Seu código de acesso ao Dashboard Bellinha:\n\n*${codigo}*\n\nVálido por 5 minutos.`)

    return res.json({ ok: true })
})

router.post('/verificar-codigo', (req, res) => {
    const { numero, codigo } = req.body
    if (!numero || !codigo) return res.status(400).json({ erro: 'Dados incompletos' })

    const num = normalizar(numero)
    const pendente = codigosPendentes.get(num)

    if (!pendente) return res.status(401).json({ erro: 'Nenhum código solicitado para este número' })
    if (Date.now() > pendente.expira) {
        codigosPendentes.delete(num)
        return res.status(401).json({ erro: 'Código expirado. Solicite um novo.' })
    }
    if (pendente.codigo !== codigo.trim()) {
        return res.status(401).json({ erro: 'Código incorreto' })
    }

    codigosPendentes.delete(num)

    const token = crypto.randomBytes(32).toString('hex')
    sessoes.set(token, { numero: num, expira: Date.now() + 8 * 60 * 60 * 1000 })

    return res.json({ token })
})

function validarSessao(token) {
    if (!token) return false
    const sessao = sessoes.get(token)
    if (!sessao) return false
    if (Date.now() > sessao.expira) { sessoes.delete(token); return false }
    return true
}

module.exports = { router, validarSessao }

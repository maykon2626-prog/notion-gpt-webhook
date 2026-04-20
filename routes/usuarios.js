const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { supabase } = require('../lib/supabase')
const { validarSessao } = require('./auth')
const { enviarWhatsApp } = require('../lib/whatsapp')

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
        .select('id, numero, nome, ativo, criado_em')
        .order('criado_em', { ascending: true })
    if (error) return res.status(500).json({ erro: error.message })
    return res.json(data)
})

router.post('/', autenticar, async (req, res) => {
    const { numero, nome, senha } = req.body
    if (!numero) return res.status(400).json({ erro: 'Número obrigatório' })
    if (!senha || senha.length < 6) return res.status(400).json({ erro: 'Senha obrigatória (mínimo 6 caracteres)' })

    const num = normalizar(numero)
    const senha_hash = await bcrypt.hash(senha, 10)

    const { data, error } = await supabase
        .from('dashboard_usuarios')
        .insert({ numero: num, nome: nome || null, senha_hash })
        .select('id, numero, nome, ativo, criado_em')
        .single()
    if (error) return res.status(500).json({ erro: error.message })

    const dashUrl = process.env.DASHBOARD_URL || `https://${req.get('host')}/dashboard`
    const primeiroNome = (data.nome || 'olá').split(' ')[0]
    enviarWhatsApp(`55${num}@s.whatsapp.net`,
        `Olá, ${primeiroNome}! 👋\n\nVocê foi cadastrado no Dashboard de Atendimento da *Bella Casa & Okada*.\n\n🔗 Acesse: ${dashUrl}\n\nComo é seu primeiro acesso, clique em *"Esqueci minha senha"* na tela de login. Você receberá um código aqui no WhatsApp para criar sua senha.\n\nQualquer dúvida, fale com o administrador.`
    ).catch(err => console.error('Erro WhatsApp novo usuário:', err.message))

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

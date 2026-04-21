const express = require('express')
const router = express.Router()

const { supabase, carregarProdutos } = require('../lib/supabase')
const { validarSessao } = require('./auth')

const normalizar = str => str?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() || ''

router.get('/', async (req, res) => {
    const token = req.headers['x-token']
    if (!await validarSessao(token)) return res.status(401).json({ erro: 'Não autorizado' })

    try {
        const { de, ate } = req.query
        let query = supabase.from('conversas').select('nome, tipo, mensagens, numero, atualizado_em')
        if (de) query = query.gte('atualizado_em', new Date(de).toISOString())
        if (ate) query = query.lte('atualizado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: conversas } = await query

        let lacunasQuery = supabase.from('lacunas').select('pergunta, criado_em').eq('revisado', false).order('criado_em', { ascending: false }).limit(10)
        if (de) lacunasQuery = lacunasQuery.gte('criado_em', new Date(de).toISOString())
        if (ate) lacunasQuery = lacunasQuery.lte('criado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: lacunas } = await lacunasQuery

        const { data: faqs } = await supabase.from('faq_gerado').select('arquivo, criado_em').order('criado_em', { ascending: false }).limit(5)

        let logQuery = supabase.from('mensagens_log').select('criado_em')
        if (de) logQuery = logQuery.gte('criado_em', new Date(de).toISOString())
        if (ate) logQuery = logQuery.lte('criado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: logData } = await logQuery
        const porHora = Array(24).fill(0)
        for (const row of logData || []) {
            const horaBRT = (new Date(row.criado_em).getUTCHours() - 3 + 24) % 24
            porHora[horaBRT]++
        }

        let tokenQuery = supabase.from('uso_tokens').select('tokens_entrada, tokens_saida')
        if (de) tokenQuery = tokenQuery.gte('criado_em', new Date(de).toISOString())
        if (ate) tokenQuery = tokenQuery.lte('criado_em', new Date(ate + 'T23:59:59').toISOString())
        const { data: tokensData } = await tokenQuery
        const totalEntrada = tokensData?.reduce((s, r) => s + (r.tokens_entrada || 0), 0) || 0
        const totalSaida = tokensData?.reduce((s, r) => s + (r.tokens_saida || 0), 0) || 0
        const custoUSD = ((totalEntrada / 1_000_000) * 3) + ((totalSaida / 1_000_000) * 15)
        const budget = parseFloat(process.env.ANTHROPIC_BUDGET_USD || '0')

        const stats = {
            total_corretores: conversas?.length || 0,
            total_mensagens: 0,
            por_corretor: [],
            por_imobiliaria: {},
            por_produto: {},
            lacunas_pendentes: lacunas || [],
            faqs_gerados: faqs || [],
            por_hora: porHora,
            tokens: {
                entrada: totalEntrada,
                saida: totalSaida,
                custo_usd: custoUSD.toFixed(4),
                saldo_usd: budget > 0 ? Math.max(0, budget - custoUSD).toFixed(2) : null,
                budget_usd: budget > 0 ? budget : null
            }
        }

        const produtos = await carregarProdutos()

        for (const conv of conversas || []) {
            const msgs = conv.mensagens || []
            const countUser = msgs.filter(m => m.role === 'user').length
            stats.total_mensagens += countUser

            if (conv.nome) {
                const tel = conv.numero?.replace('@s.whatsapp.net', '').replace('@g.us', '') || ''
                stats.por_corretor.push({ nome: conv.nome, tipo: conv.tipo || 'Autônomo', mensagens: countUser, telefone: tel })
            }

            const imob = conv.tipo?.trim() || 'Autônomo'
            const imobKey = normalizar(imob)
            const imobLabel = stats.por_imobiliaria[imobKey]?.label || imob
            stats.por_imobiliaria[imobKey] = {
                label: imobLabel,
                count: (stats.por_imobiliaria[imobKey]?.count || 0) + countUser,
                corretores: (stats.por_imobiliaria[imobKey]?.corretores || 0) + (conv.nome ? 1 : 0)
            }

            for (const m of msgs) {
                if (m.role === 'user') {
                    for (const prod of produtos) {
                        if (m.content?.toLowerCase().includes(prod.toLowerCase())) {
                            stats.por_produto[prod] = (stats.por_produto[prod] || 0) + 1
                        }
                    }
                }
            }
        }

        stats.por_corretor.sort((a, b) => b.mensagens - a.mensagens)
        stats.por_imobiliaria = Object.values(stats.por_imobiliaria).sort((a, b) => b.count - a.count)

        return res.json(stats)
    } catch (err) {
        return res.status(500).json({ erro: err.message })
    }
})

module.exports = router

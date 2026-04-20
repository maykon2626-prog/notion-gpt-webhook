require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')
const Anthropic = require('@anthropic-ai/sdk')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const normalizar = str => str?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() || ''

async function extrairPrimeiroNome(nome) {
    if (!nome || !nome.includes(' ')) return nome
    const res = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 30,
        system: 'Extraia apenas o primeiro nome. Responda APENAS em JSON: {"nome": "..."}',
        messages: [{ role: 'user', content: nome }]
    })
    try {
        return JSON.parse(res.content[0].text).nome || nome
    } catch { return nome }
}

async function limpar() {
    console.log('Buscando conversas...\n')
    const { data: conversas, error } = await supabase.from('conversas').select('numero, nome, tipo')
    if (error) { console.error('Erro:', error.message); return }
    if (!conversas?.length) { console.log('Nenhuma conversa encontrada.'); return }

    // ── Normalizar imobiliárias ──────────────────────────────────────────────
    // Agrupa por forma normalizada e escolhe o nome mais frequente como canônico
    const gruposImob = {}
    for (const c of conversas) {
        if (!c.tipo) continue
        const chave = normalizar(c.tipo)
        if (!gruposImob[chave]) gruposImob[chave] = {}
        gruposImob[chave][c.tipo] = (gruposImob[chave][c.tipo] || 0) + 1
    }

    // Para cada grupo, escolhe o nome com mais ocorrências como canônico
    const mapeamentoImob = {} // "nome variante" → "nome canônico"
    for (const [chave, variantes] of Object.entries(gruposImob)) {
        const canonico = Object.entries(variantes).sort((a, b) => b[1] - a[1])[0][0]
        for (const variante of Object.keys(variantes)) {
            if (variante !== canonico) mapeamentoImob[variante] = canonico
        }
    }

    if (Object.keys(mapeamentoImob).length) {
        console.log('Imobiliárias a normalizar:')
        for (const [de, para] of Object.entries(mapeamentoImob)) {
            console.log(`  "${de}" → "${para}"`)
        }
    } else {
        console.log('Imobiliárias: nenhuma variação encontrada.')
    }

    // ── Normalizar nomes de corretores ───────────────────────────────────────
    const nomesParaCorrigir = []
    for (const c of conversas) {
        if (c.nome && c.nome.includes(' ')) {
            nomesParaCorrigir.push(c)
        }
    }

    const mapeamentoNomes = {}
    if (nomesParaCorrigir.length) {
        console.log(`\nCorretores com nome completo (${nomesParaCorrigir.length}):`)
        for (const c of nomesParaCorrigir) {
            const primeiroNome = await extrairPrimeiroNome(c.nome)
            if (primeiroNome !== c.nome) {
                mapeamentoNomes[c.numero] = primeiroNome
                console.log(`  "${c.nome}" → "${primeiroNome}" (${c.numero})`)
            }
            await new Promise(r => setTimeout(r, 300))
        }
    } else {
        console.log('\nNomes: nenhum nome completo encontrado.')
    }

    // ── Aplicar correções ────────────────────────────────────────────────────
    const totalImob = Object.keys(mapeamentoImob).length
    const totalNomes = Object.keys(mapeamentoNomes).length

    if (!totalImob && !totalNomes) {
        console.log('\nNada a corrigir.')
        return
    }

    console.log(`\nAplicando ${totalImob} correções de imobiliária e ${totalNomes} de nome...`)

    for (const c of conversas) {
        const updates = {}

        if (c.tipo && mapeamentoImob[c.tipo]) updates.tipo = mapeamentoImob[c.tipo]
        if (mapeamentoNomes[c.numero]) updates.nome = mapeamentoNomes[c.numero]

        if (Object.keys(updates).length) {
            const { error } = await supabase.from('conversas').update(updates).eq('numero', c.numero)
            if (error) console.error(`  Erro em ${c.numero}:`, error.message)
            else console.log(`  Atualizado: ${c.numero}`)
        }
    }

    console.log('\nLimpeza concluída!')
}

limpar()

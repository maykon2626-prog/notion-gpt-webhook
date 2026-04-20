const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)

let produtosCache = { lista: [], atualizadoEm: 0 }

async function carregarProdutos() {
    if (Date.now() - produtosCache.atualizadoEm < 5 * 60 * 1000) return produtosCache.lista
    const { data } = await supabase.from('produtos').select('nome').eq('ativo', true).order('nome')
    produtosCache = { lista: data?.map(r => r.nome) || [], atualizadoEm: Date.now() }
    return produtosCache.lista
}

async function carregarConversa(numero) {
    const { data, error } = await supabase
        .from('conversas')
        .select('*')
        .eq('numero', numero)
        .single()

    if (error || !data) return { nome: '', tipo: '', resumo: '', mensagens: [], ativo: false, pendente_grupo: '', pendente_produto: null }
    return {
        nome: data.nome || '',
        tipo: data.tipo || '',
        resumo: data.resumo || '',
        mensagens: data.mensagens || [],
        ativo: data.ativo || false,
        pendente_grupo: data.pendente_grupo || '',
        pendente_produto: data.pendente_produto || null
    }
}

async function salvarConversa(numero, nome, tipo, resumo, mensagens, ativo = false) {
    const { error } = await supabase.from('conversas').upsert({
        numero,
        nome,
        tipo,
        resumo,
        mensagens,
        ativo,
        atualizado_em: new Date().toISOString()
    }, { onConflict: 'numero' })
    if (error) console.error('Erro ao salvar conversa:', error.message)
}

module.exports = { supabase, carregarProdutos, carregarConversa, salvarConversa }

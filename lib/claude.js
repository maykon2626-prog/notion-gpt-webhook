const Anthropic = require('@anthropic-ai/sdk')
const { supabase, carregarProdutos } = require('./supabase')

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// Cache de instrução com TTL de 5 minutos
let instrucaoCache = null
let instrucaoCacheAt = 0

const INSTRUCAO_PADRAO = `Você é Bellinha, assistente virtual da Bella Casa & Okada.
Responda sempre no feminino e use primeira pessoa do plural ao falar da empresa.
Seja profissional, próxima e direta. Use emojis com moderação.
Responda apenas com base no contexto fornecido.
Se não souber, diga: "Não tenho esse dado disponível. Recomendo consultar o gerente comercial."

REGRAS:
- Sempre confirme o empreendimento antes de falar de pagamento
- Inclua sempre o aviso do Gerlotes ao informar valores
- Nunca misture dados de empreendimentos diferentes
- Respostas curtas e objetivas
- Chame o corretor pelo nome ({nome}) quando apropriado
- NUNCA use asteriscos, underlines ou qualquer marcação de texto. Use apenas texto puro e emojis`

async function carregarInstrucao() {
    if (instrucaoCache && Date.now() - instrucaoCacheAt < 5 * 60 * 1000) return instrucaoCache
    try {
        const { data } = await supabase.from('bellinha_config').select('valor').eq('chave', 'instrucoes').single()
        instrucaoCache = data?.valor || INSTRUCAO_PADRAO
    } catch {
        instrucaoCache = INSTRUCAO_PADRAO
    }
    instrucaoCacheAt = Date.now()
    return instrucaoCache
}

async function claudeCreate(params) {
    const response = await anthropic.messages.create(params)
    supabase.from('uso_tokens').insert({
        modelo: params.model || 'claude-sonnet-4-6',
        tokens_entrada: response.usage?.input_tokens || 0,
        tokens_saida: response.usage?.output_tokens || 0
    }).then(({ error }) => { if (error) console.error('Erro ao salvar tokens:', error.message) })
    return response
}

async function extrairInfoCorretor(texto) {
    const { data: existentes } = await supabase
        .from('conversas')
        .select('tipo')
        .not('tipo', 'is', null)
        .neq('tipo', '')
    const tiposExistentes = [...new Set((existentes || []).map(r => r.tipo).filter(Boolean))]

    const listaStr = tiposExistentes.length
        ? `Imobiliárias já cadastradas: ${tiposExistentes.join(', ')}.`
        : ''

    const res = await claudeCreate({
        model: 'claude-sonnet-4-6',
        max_tokens: 80,
        system: `Extraia o nome e vínculo profissional da mensagem. Responda APENAS em JSON: {"nome": "...", "tipo": "..."}.
Para "nome": apenas o primeiro nome. Para "tipo": se autônomo use "Autônomo", se mencionar imobiliária extraia o nome dela.
${listaStr ? listaStr + ' Se o tipo extraído for parecido com alguma já cadastrada (ex: "hom" e "hom imóveis"), use o nome já cadastrado exatamente.' : ''}
Se não identificar tipo, deixe "".`,
        messages: [{ role: 'user', content: texto }]
    })
    try {
        return JSON.parse(res.content[0].text)
    } catch {
        return { nome: texto.trim(), tipo: '' }
    }
}

async function normalizarTipo(texto) {
    const { data: existentes } = await supabase
        .from('conversas')
        .select('tipo')
        .not('tipo', 'is', null)
        .neq('tipo', '')
    const tiposExistentes = [...new Set((existentes || []).map(r => r.tipo).filter(Boolean))]

    const listaStr = tiposExistentes.length
        ? `Imobiliárias já cadastradas: ${tiposExistentes.join(', ')}.`
        : ''

    const res = await claudeCreate({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        system: `Extraia o vínculo profissional da mensagem. Responda APENAS em JSON: {"tipo": "..."}.
Se for autônomo use "Autônomo". Se mencionar imobiliária, extraia o nome dela.
${listaStr ? listaStr + ' Se o nome for parecido com alguma já cadastrada, use o nome cadastrado exatamente.' : ''}
Se não identificar, use o texto original.`,
        messages: [{ role: 'user', content: texto }]
    })
    try {
        const info = JSON.parse(res.content[0].text)
        return info.tipo || texto.trim()
    } catch {
        return texto.trim()
    }
}

async function detectarProduto(texto) {
    const lista = await carregarProdutos()
    if (!lista.length) return { produto: null, ambiguo: false }
    const res = await claudeCreate({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        system: `Analise se a mensagem menciona algum empreendimento desta lista: ${lista.join(', ')}.
Responda APENAS em JSON:
- Menciona claramente um: {"produto": "nome exato da lista", "ambiguo": false}
- Ambíguo (pode ser mais de um): {"produto": null, "ambiguo": true, "candidatos": ["nome1", "nome2"]}
- Não menciona nenhum: {"produto": null, "ambiguo": false}`,
        messages: [{ role: 'user', content: texto }]
    })
    try { return JSON.parse(res.content[0].text) }
    catch { return { produto: null, ambiguo: false } }
}

async function resolverProduto(resposta, candidatos) {
    const res = await claudeCreate({
        model: 'claude-sonnet-4-6',
        max_tokens: 50,
        system: `O usuário está escolhendo entre: ${candidatos.map((p, i) => `${i + 1}. ${p}`).join(', ')}. Responda APENAS em JSON: {"produto": "nome exato escolhido"}. Se não identificar, use o primeiro.`,
        messages: [{ role: 'user', content: resposta }]
    })
    try {
        const info = JSON.parse(res.content[0].text)
        return info.produto || candidatos[0]
    } catch { return candidatos[0] }
}

async function gerarResumo(nome, resumoAnterior, mensagens) {
    try {
        const historico = mensagens.map(m => `${m.role === 'user' ? 'Corretor' : 'Bellinha'}: ${m.content}`).join('\n')
        const response = await claudeCreate({
            model: 'claude-sonnet-4-6',
            max_tokens: 300,
            system: 'Você resume conversas de atendimento imobiliário de forma concisa. Foque em: empreendimentos consultados, dúvidas levantadas e informações importantes trocadas.',
            messages: [{
                role: 'user',
                content: `Corretor: ${nome}\n\nResumo anterior: ${resumoAnterior || 'nenhum'}\n\nConversa:\n${historico}\n\nGere um resumo atualizado em até 3 frases.`
            }]
        })
        return response.content[0].text
    } catch (err) {
        console.error('Erro ao gerar resumo:', err.message)
        return resumoAnterior
    }
}

async function perguntarClaude(nome, resumo, historico, contexto, pergunta, imagemBase64 = null) {
    try {
        const historicoFormatado = historico.map(m => ({ role: m.role, content: m.content }))

        const instrucaoBase = await carregarInstrucao()
        const system = instrucaoBase.replace('{nome}', nome || 'corretor') +
            `\n\n${resumo ? `RESUMO DO HISTÓRICO:\n${resumo}\n\n` : ''}CONTEXTO DOS EMPREENDIMENTOS:\n${contexto || 'Sem contexto disponível.'}`

        const response = await Promise.race([
            claudeCreate({
                model: 'claude-sonnet-4-6',
                max_tokens: 512,
                system,
                messages: [...historicoFormatado, {
                    role: 'user',
                    content: imagemBase64 ? [
                        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imagemBase64 } },
                        { type: 'text', text: pergunta || 'O que você vê nessa imagem? Relate ao contexto dos empreendimentos se relevante.' }
                    ] : pergunta
                }]
            }),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Timeout')), 25000)
            )
        ])
        return response.content[0].text
    } catch (err) {
        console.error('Erro no Claude:', err.message)
        return 'Não consegui processar sua pergunta agora. Tente novamente.'
    }
}

module.exports = { claudeCreate, extrairInfoCorretor, normalizarTipo, detectarProduto, resolverProduto, gerarResumo, perguntarClaude }

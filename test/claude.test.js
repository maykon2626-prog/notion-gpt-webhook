process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-key'
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://example.supabase.co'
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-key'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
    construirSystemBellinha,
    filtrarHistoricoParaClaude,
    prepararEntradaClaude
} = require('../lib/claude')

test('construirSystemBellinha reforca memoria quando o nome ja e conhecido', () => {
    const system = construirSystemBellinha({
        instrucaoBase: 'Use {nome} ao responder.',
        nome: 'Maykon',
        tipo: 'Hom',
        resumo: 'Ja conversamos sobre o Noah Beach.',
        contexto: 'Noah Beach',
        historico: [{ role: 'assistant', content: 'Oi, Maykon!' }]
    })

    assert.ok(system.includes('Use Maykon ao responder.'))
    assert.ok(system.includes('Nome do corretor: Maykon'))
    assert.ok(system.includes('Nunca peca o nome novamente.'))
    assert.ok(system.includes('Nunca pergunte novamente sobre imobiliaria ou autonomia.'))
    assert.ok(system.includes('Nunca diga que nao consegue acessar conversas anteriores.'))
})

test('filtrarHistoricoParaClaude remove onboarding antigo quando nome e tipo ja sao conhecidos', () => {
    const historico = [
        { role: 'assistant', content: 'Olá! 😊 Sou a Bellinha, assistente virtual da Bella Casa & Okada.\n\nAcho que a gente ainda não se conhece! Qual é o seu nome?' },
        { role: 'user', content: 'Maykon' },
        { role: 'assistant', content: 'Prazer, Maykon! 😊 Você trabalha em alguma imobiliária? Se sim, qual? Ou é autônomo?' },
        { role: 'user', content: 'eu sou da Hom' },
        { role: 'assistant', content: 'Anotado! 😊 Da Hom, Maykon! Pode perguntar, estou aqui para te ajudar!' },
        { role: 'assistant', content: 'Peço desculpas pela confusão! Infelizmente não consigo acessar conversas anteriores. 😊\n\nPode me dizer seu nome novamente pra eu te atender melhor?' },
        { role: 'user', content: 'Me fale sobre o Noah Beach' },
        { role: 'assistant', content: 'O Noah Beach e o nosso lancamento com conceito beach club.' }
    ]

    const filtrado = filtrarHistoricoParaClaude(historico, { nome: 'Maykon', tipo: 'Hom' })

    assert.deepEqual(filtrado, [
        { role: 'user', content: 'Me fale sobre o Noah Beach' },
        { role: 'assistant', content: 'O Noah Beach e o nosso lancamento com conceito beach club.' }
    ])
})

test('prepararEntradaClaude envia a pergunta atual uma unica vez', () => {
    const pergunta = 'Fala um pouco sobre o Noah beach'
    const { messages } = prepararEntradaClaude({
        nome: 'Maykon',
        tipo: 'Hom',
        historico: [
            { role: 'assistant', content: 'Oi, Maykon! Como posso ajudar?' },
            { role: 'user', content: pergunta }
        ],
        contexto: 'Noah Beach',
        pergunta
    })

    const ocorrenciasPergunta = messages
        .filter(m => typeof m.content === 'string' && m.content === pergunta)
        .length

    assert.equal(ocorrenciasPergunta, 1)
    assert.deepEqual(messages, [
        { role: 'assistant', content: 'Oi, Maykon! Como posso ajudar?' },
        { role: 'user', content: pergunta }
    ])
})

let tokenAtual = sessionStorage.getItem('dash_token') || ''
let graficoHoras = null

// ── Helpers ──────────────────────────────────────

function $(id) { return document.getElementById(id) }

function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function mostrarErro(id, msg) { $(id).textContent = msg }
function limparMensagens(erroId, okId) { $(erroId).textContent = ''; if (okId) $(okId).textContent = '' }

function setCarregando(btnId, on, texto) {
  const btn = $(btnId); btn.disabled = on; btn.textContent = on ? 'Aguarde...' : texto
}

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-token': tokenAtual, ...(opts.headers || {}) }
  })
}

// ── Sidebar ───────────────────────────────────────

// ── Top Navigation ────────────────────────────────

function toggleTopnavDropdown(id) {
  const item = document.getElementById('tnav-item-' + id)
  if (!item) return
  const isOpen = item.classList.contains('open')
  // fecha todos
  document.querySelectorAll('.topnav-item.open').forEach(el => el.classList.remove('open'))
  if (!isOpen) item.classList.add('open')
}

function fecharTopnavDropdowns() {
  document.querySelectorAll('.topnav-item.open').forEach(el => el.classList.remove('open'))
}

function toggleTopnavMobile() {
  const menu = $('topnav-menu')
  const overlay = $('topnav-overlay')
  const open = menu.classList.toggle('mobile-open')
  overlay.classList.toggle('open', open)
}

document.addEventListener('click', e => {
  if (!e.target.closest('.topnav-item') && !e.target.closest('#topnav-hamburger')) {
    fecharTopnavDropdowns()
  }
  if (!e.target.closest('#topnav') && !e.target.closest('#topnav-overlay')) {
    const menu = $('topnav-menu')
    const overlay = $('topnav-overlay')
    if (menu) menu.classList.remove('mobile-open')
    if (overlay) overlay.classList.remove('open')
  }
})

// ── Navegação ─────────────────────────────────────

function navegarPara(pagina) {
  // topnav active state
  document.querySelectorAll('.topnav-item[data-pagina], .topnav-dropdown li[data-pagina]').forEach(el => el.classList.remove('active'))
  document.querySelectorAll(`[data-pagina="${pagina}"]`).forEach(el => el.classList.add('active'))

  // páginas
  document.querySelectorAll('#conteudo > div[id^="pagina-"]').forEach(el => el.style.display = 'none')
  $(`pagina-${pagina}`).style.display = 'block'

  if (pagina === 'crm-pipeline') { $('pagina-crm-pipeline').style.display = 'flex'; carregarLeads().then(renderizarKanban) }
  if (pagina === 'crm-clientes') carregarLeads().then(renderizarClientes)
  if (pagina === 'empreendimentos') carregarEmpreendimentos()
  if (pagina === 'usuarios-administradores') carregarUsuarios()
  if (pagina === 'usuarios-corretores') carregarCorretores()
  if (pagina === 'bellinha-instrucoes') carregarInstrucoes()
  if (pagina === 'bellinha-treinamento') carregarDocs()

  // fecha dropdown e menu mobile
  fecharTopnavDropdowns()
  const menu = $('topnav-menu')
  const overlay = $('topnav-overlay')
  if (menu) menu.classList.remove('mobile-open')
  if (overlay) overlay.classList.remove('open')
}

// ── Login ─────────────────────────────────────────

function mostrarLogin() {
  $('passo-login').style.display = 'block'
  $('passo-recuperar').style.display = 'none'
  $('passo-redefinir').style.display = 'none'
  mostrarErro('erro', '')
}

function mostrarRecuperacao() {
  $('passo-login').style.display = 'none'
  $('passo-recuperar').style.display = 'block'
  mostrarErro('erro', '')
}

async function fazerLogin() {
  const numero = $('input-numero').value.trim()
  const senha = $('input-senha-login').value
  if (!numero || !senha) return mostrarErro('erro', 'Preencha número e senha')
  mostrarErro('erro', '')
  setCarregando('btn-login', true, 'Entrar')

  const r = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero, senha })
  })
  const data = await r.json()
  setCarregando('btn-login', false, 'Entrar')
  if (!r.ok) return mostrarErro('erro', data.erro || 'Erro ao entrar')

  tokenAtual = data.token
  sessionStorage.setItem('dash_token', tokenAtual)
  if (data.nome) sessionStorage.setItem('dash_nome', data.nome)
  await abrirApp()
}

async function solicitarRecuperacao() {
  const numero = $('input-rec-numero').value.trim()
  if (!numero) return mostrarErro('erro', 'Informe o número')
  mostrarErro('erro', '')
  setCarregando('btn-rec-enviar', true, 'Enviar código')

  await fetch('/auth/recuperar/solicitar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero })
  })
  setCarregando('btn-rec-enviar', false, 'Enviar código')

  $('passo-recuperar').style.display = 'none'
  $('passo-redefinir').style.display = 'block'
  $('input-rec-codigo').focus()
}

async function redefinirSenha() {
  const numero = $('input-rec-numero').value.trim()
  const codigo = $('input-rec-codigo').value.trim()
  const nova_senha = $('input-nova-senha').value
  const confirmar = $('input-confirmar-senha').value
  if (!codigo) return mostrarErro('erro', 'Informe o código')
  if (!nova_senha) return mostrarErro('erro', 'Informe a nova senha')
  if (nova_senha !== confirmar) return mostrarErro('erro', 'As senhas não coincidem')
  mostrarErro('erro', '')
  setCarregando('btn-redefinir', true, 'Redefinir senha')

  const r = await fetch('/auth/recuperar/redefinir', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero, codigo, nova_senha })
  })
  const data = await r.json()
  setCarregando('btn-redefinir', false, 'Redefinir senha')
  if (!r.ok) return mostrarErro('erro', data.erro || 'Erro ao redefinir')

  mostrarLogin()
  mostrarErro('erro', '')
  $('input-senha-login').value = ''
  $('passo-login').querySelector('p').textContent = 'Senha redefinida! Faça login com a nova senha.'
}

function preencherTopbar() {
  const nome = sessionStorage.getItem('dash_nome') || ''
  const iniciais = nome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?'
  const el = $('topbar-nome'); if (el) el.textContent = nome || 'Usuário'
  const av = $('user-avatar'); if (av) av.textContent = iniciais
}

function toggleUserMenu() {
  const profile = $('user-profile')
  const dropdown = $('user-dropdown')
  if (!profile || !dropdown) return
  const open = dropdown.classList.toggle('open')
  profile.classList.toggle('open', open)
}

document.addEventListener('click', (e) => {
  const profile = $('user-profile')
  if (profile && !profile.contains(e.target)) {
    $('user-dropdown')?.classList.remove('open')
    profile.classList.remove('open')
  }
})

async function abrirApp() {
  const r = await api('/analytics')
  if (r.status === 401) { sessionStorage.removeItem('dash_token'); tokenAtual = ''; return }
  const data = await r.json()
  $('login').style.display = 'none'
  $('app').style.display = 'block'
  preencherTopbar()
  renderizar(data)
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {})
  sessionStorage.removeItem('dash_token')
  sessionStorage.removeItem('dash_nome')
  tokenAtual = ''
  $('app').style.display = 'none'
  document.documentElement.classList.remove('logado')
  $('login').style.display = ''
  mostrarLogin()
  $('input-numero').value = ''
  $('input-senha-login').value = ''
}

if (tokenAtual) abrirApp()

// ── Analytics ─────────────────────────────────────

async function filtrar() {
  const de = $('f-de').value
  const ate = $('f-ate').value
  const params = new URLSearchParams()
  if (de) params.append('de', de)
  if (ate) params.append('ate', ate)
  const url = '/analytics' + (params.toString() ? '?' + params.toString() : '')
  $('f-label').textContent = de || ate ? `Filtrando: ${de || 'início'} → ${ate || 'hoje'}` : ''
  renderizar(await (await api(url)).json())
}

async function limparFiltro() {
  $('f-de').value = ''; $('f-ate').value = ''; $('f-label').textContent = ''
  renderizar(await (await api('/analytics')).json())
}

function renderizar(d) {
  $('total-corretores').textContent = d.total_corretores
  $('total-mensagens').textContent = d.total_mensagens
  $('total-lacunas').textContent = d.lacunas_pendentes.length
  $('total-faqs').textContent = d.faqs_gerados.length

  $('tb-corretores').innerHTML = d.por_corretor.slice(0, 10).map((c, i) => `
    <tr>
      <td>${i + 1}</td><td>${esc(c.nome)}</td>
      <td><a href="https://wa.me/${esc(c.telefone)}" target="_blank" style="color:#7A8C5F;text-decoration:none;font-size:13px">📱 ${esc(c.telefone)}</a></td>
      <td><span class="tag">${esc(c.tipo)}</span></td><td>${esc(c.mensagens)}</td>
    </tr>`).join('')

  const maxImob = Math.max(...d.por_imobiliaria.map(i => i.count), 1)
  $('imob-list').innerHTML = d.por_imobiliaria.map(i => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>${esc(i.label)}</span>
        <span style="color:#8C8880">${esc(i.corretores)} corretor${i.corretores !== 1 ? 'es' : ''} · ${esc(i.count)} msgs</span>
      </div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(i.count / maxImob * 100)}%"></div></div>
    </div>`).join('')

  const maxProd = Math.max(...Object.values(d.por_produto), 1)
  $('prod-list').innerHTML = Object.entries(d.por_produto).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span>${esc(k)}</span><span>${esc(v)}</span></div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(v / maxProd * 100)}%"></div></div>
    </div>`).join('')

  $('lacunas-list').innerHTML = d.lacunas_pendentes.length
    ? d.lacunas_pendentes.map(l => `<div class="lacuna">❓ ${esc(l.pergunta)}</div>`).join('')
    : '<p style="color:#8C8880;font-size:13px">Nenhuma lacuna pendente 🎉</p>'

  if (d.por_hora) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)
    if (graficoHoras) graficoHoras.destroy()
    graficoHoras = new Chart($('grafico-horas'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Mensagens', data: d.por_hora, backgroundColor: '#7A8C5F', borderRadius: 6 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } } }
    })
  }

  if (d.tokens) {
    $('tokens-entrada').textContent = d.tokens.entrada.toLocaleString('pt-BR')
    $('tokens-saida').textContent = d.tokens.saida.toLocaleString('pt-BR')
    $('custo-usd').textContent = `$${d.tokens.custo_usd}`
    if (d.tokens.saldo_usd !== null) {
      $('saldo-usd').textContent = `$${d.tokens.saldo_usd}`
      $('card-saldo').style.display = 'block'
    }
  }
}

// ── Usuários ──────────────────────────────────────

async function carregarUsuarios() {
  const r = await api('/usuarios')
  if (!r.ok) return
  const usuarios = await r.json()
  $('tb-usuarios').innerHTML = usuarios.map(u => `
    <tr>
      <td>${u.nome ? esc(u.nome) : '<span style="color:#8C8880">—</span>'}</td>
      <td>📱 ${esc(u.numero)}</td>
      <td style="color:#8C8880;font-size:13px">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td><button class="btn-danger" onclick="removerUsuario('${esc(u.numero)}', this)">Remover</button></td>
    </tr>`).join('')
}

async function adicionarUsuario() {
  const nome = $('novo-nome').value.trim()
  const numero = $('novo-numero').value.trim()
  const senha = $('novo-senha').value
  mostrarErro('erro-usuarios', '')
  if (!numero) return mostrarErro('erro-usuarios', 'Informe o número')
  if (!senha) return mostrarErro('erro-usuarios', 'Informe uma senha')

  const r = await api('/usuarios', { method: 'POST', body: JSON.stringify({ nome, numero, senha }) })
  const data = await r.json()
  if (!r.ok) return mostrarErro('erro-usuarios', data.erro || 'Erro ao adicionar')
  $('novo-nome').value = ''; $('novo-numero').value = ''; $('novo-senha').value = ''
  carregarUsuarios()
}

async function removerUsuario(numero, btn) {
  if (!confirm(`Remover o usuário ${numero}?`)) return
  btn.disabled = true; btn.textContent = '...'
  const r = await api(`/usuarios/${numero}`, { method: 'DELETE' })
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Remover'; return }
  carregarUsuarios()
}

// ── Corretores ────────────────────────────────────

let corretoresData = []

async function carregarCorretores() {
  const r = await api('/usuarios/corretores')
  if (!r.ok) return
  corretoresData = await r.json()
  filtrarCorretores()
}

function filtrarCorretores() {
  const busca = ($('corretores-busca')?.value || '').toLowerCase()
  const lista = busca
    ? corretoresData.filter(c => (c.nome || '').toLowerCase().includes(busca) || (c.numero || '').includes(busca))
    : corretoresData

  const tbody = $('tb-corretores-full')
  const vazio = $('corretores-vazio')
  const tabela = $('corretores-tabela')
  const total = $('corretores-total')
  if (!tbody) return

  if (total) total.textContent = `${lista.length} corretor${lista.length !== 1 ? 'es' : ''}`

  if (!lista.length) {
    tbody.innerHTML = ''
    tabela.style.display = 'none'
    vazio.style.display = 'block'
    return
  }
  tabela.style.display = ''
  vazio.style.display = 'none'

  const formatarData = d => d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—'
  const totalMsgs = lista.reduce((s, c) => s + (c.mensagens?.length || 0), 0)

  tbody.innerHTML = lista.map((c, i) => {
    const msgs = c.mensagens?.length || 0
    const pct = totalMsgs ? Math.round(msgs / totalMsgs * 100) : 0
    return `<tr>
      <td style="color:var(--text-muted);font-size:13px">${i + 1}</td>
      <td style="font-weight:500">${c.nome ? esc(c.nome) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="color:var(--text-muted)">📱 ${esc(c.numero || '—')}</td>
      <td><span class="tag">${esc(c.tipo || '—')}</span></td>
      <td>
        <span style="font-weight:500">${msgs}</span>
        <div class="bar-wrap" style="margin-top:4px;width:80px"><div class="bar" style="width:${pct}%"></div></div>
      </td>
      <td style="color:var(--text-muted);font-size:13px">${formatarData(c.atualizado_em)}</td>
    </tr>`
  }).join('')
}

// ── Bellinha ──────────────────────────────────────

async function carregarInstrucoes() {
  mostrarErro('erro-instrucoes', '')
  mostrarErro('ok-instrucoes', '')
  const r = await api('/bellinha/instrucoes')
  if (!r.ok) return mostrarErro('erro-instrucoes', 'Erro ao carregar')
  const data = await r.json()
  $('instrucoes-texto').value = data.instrucoes
}

async function salvarInstrucoes() {
  const instrucoes = $('instrucoes-texto').value.trim()
  mostrarErro('erro-instrucoes', '')
  mostrarErro('ok-instrucoes', '')
  if (!instrucoes) return mostrarErro('erro-instrucoes', 'Instruções não podem estar vazias')
  setCarregando('btn-salvar-instrucoes', true, 'Salvar')
  const r = await api('/bellinha/instrucoes', { method: 'PUT', body: JSON.stringify({ instrucoes }) })
  setCarregando('btn-salvar-instrucoes', false, 'Salvar')
  const data = await r.json()
  if (!r.ok) return mostrarErro('erro-instrucoes', data.erro || 'Erro ao salvar')
  mostrarErro('ok-instrucoes', 'Salvo! A Bellinha já usa as novas instruções.')
}

// ── Treinamento Bellinha ──────────────────────────

let treinoPastas = {}       // { pasta: [{arquivo, nome, chunks, preview}] }
let treinoArquivoAtivo = null
let treinoModalModo = null  // 'doc' | 'pasta'

async function carregarDocs() {
  const r = await api('/bellinha/docs')
  if (!r.ok) return
  treinoPastas = await r.json()
  renderizarArvore()
}

function renderizarArvore() {
  const arvore = $('treino-arvore')
  if (!arvore) return
  const pastas = Object.keys(treinoPastas).sort()

  // Atualiza datalist para autocomplete no modal
  const dl = $('pastas-list')
  if (dl) dl.innerHTML = pastas.filter(p => p !== '(raiz)').map(p => `<option value="${esc(p)}">`).join('')

  if (!pastas.length) {
    arvore.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:12px 10px">Nenhum documento ainda.</p>'
    return
  }

  arvore.innerHTML = pastas.map(pasta => {
    const docs = treinoPastas[pasta]
    const isPastaReal = pasta !== '(raiz)'
    return `
      <div class="treino-pasta${isPastaReal ? ' open' : ''}" data-pasta="${esc(pasta)}">
        ${isPastaReal ? `
        <div class="treino-pasta-header" onclick="togglePasta(this)">
          <span class="treino-pasta-arrow">▸</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--accent)"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pasta)}</span>
          <span class="treino-pasta-acoes">
            <button class="treino-pasta-acao" title="Renomear pasta" onclick="event.stopPropagation();renomearPasta('${esc(pasta)}')">✏️</button>
            <button class="treino-pasta-acao danger" title="Excluir pasta" onclick="event.stopPropagation();deletarPasta('${esc(pasta)}')">🗑</button>
          </span>
        </div>` : ''}
        <div class="treino-pasta-docs">
          ${docs.map(d => `
            <div class="treino-doc-item${treinoArquivoAtivo === d.arquivo ? ' active' : ''}"
              onclick="abrirDoc('${esc(d.arquivo)}')" data-arquivo="${esc(d.arquivo)}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.nome)}</span>
              <button class="treino-doc-delete" onclick="event.stopPropagation();deletarDocItem('${esc(d.arquivo)}')" title="Excluir">×</button>
            </div>`).join('')}
        </div>
      </div>`
  }).join('')
}

function togglePasta(header) {
  header.closest('.treino-pasta').classList.toggle('open')
}

async function abrirDoc(arquivo) {
  treinoArquivoAtivo = arquivo
  renderizarArvore()
  mostrarErro('ok-treino', '')
  mostrarErro('erro-treino', '')

  const partes = arquivo.split('/')
  const nome = partes[partes.length - 1].replace(/\.txt$/, '')
  $('treino-doc-nome').value = nome
  $('treino-doc-conteudo').value = 'Carregando...'
  $('treino-doc-info').textContent = ''
  $('treino-editor-content').style.display = 'flex'
  document.querySelector('.treino-editor-empty').style.display = 'none'

  const r = await api('/bellinha/docs/conteudo?arquivo=' + encodeURIComponent(arquivo))
  if (!r.ok) { $('treino-doc-conteudo').value = ''; return }
  const data = await r.json()
  $('treino-doc-conteudo').value = data.conteudo
  $('treino-doc-info').textContent = `${data.conteudo.split(/\s+/).length} palavras`
}

function cancelarEdicao() {
  treinoArquivoAtivo = null
  renderizarArvore()
  $('treino-editor-content').style.display = 'none'
  document.querySelector('.treino-editor-empty').style.display = 'flex'
}

async function salvarDoc() {
  if (!treinoArquivoAtivo) return
  const conteudo = $('treino-doc-conteudo').value.trim()
  const novoNome = $('treino-doc-nome').value.trim()
  mostrarErro('ok-treino', '')
  mostrarErro('erro-treino', '')
  if (!conteudo) return mostrarErro('erro-treino', 'Conteúdo vazio')

  setCarregando('btn-salvar-doc', true, 'Salvar e reindexar')

  // Renomear se nome mudou
  const partes = treinoArquivoAtivo.split('/')
  const nomAtual = partes[partes.length - 1].replace(/\.txt$/, '')
  let arquivoFinal = treinoArquivoAtivo

  if (novoNome && novoNome !== nomAtual) {
    partes[partes.length - 1] = novoNome + '.txt'
    arquivoFinal = partes.join('/')
    await api('/bellinha/docs/renomear', { method: 'POST', body: JSON.stringify({ de: treinoArquivoAtivo, para: arquivoFinal, tipo: 'doc' }) })
    treinoArquivoAtivo = arquivoFinal
  }

  const r = await api('/bellinha/docs/conteudo', { method: 'PUT', body: JSON.stringify({ arquivo: arquivoFinal, conteudo }) })
  const data = await r.json()
  setCarregando('btn-salvar-doc', false, 'Salvar e reindexar')
  if (!r.ok) return mostrarErro('erro-treino', data.erro || 'Erro ao salvar')
  mostrarErro('ok-treino', `Salvo (${data.chunks} chunks)`)
  $('treino-doc-info').textContent = `${conteudo.split(/\s+/).length} palavras`
  carregarDocs()
}

async function deletarDocItem(arquivo) {
  if (!confirm(`Excluir "${arquivo}"?`)) return
  await api('/bellinha/docs/' + encodeURIComponent(arquivo), { method: 'DELETE' })
  if (treinoArquivoAtivo === arquivo) cancelarEdicao()
  carregarDocs()
}

async function deletarDocAtivo() {
  if (!treinoArquivoAtivo) return
  await deletarDocItem(treinoArquivoAtivo)
}

async function deletarPasta(pasta) {
  if (!confirm(`Excluir a pasta "${pasta}" e todos os documentos dentro?`)) return
  await api('/bellinha/docs/pasta/' + encodeURIComponent(pasta), { method: 'DELETE' })
  if (treinoArquivoAtivo?.startsWith(pasta + '/')) cancelarEdicao()
  carregarDocs()
}

function renomearPasta(pasta) {
  const novo = prompt(`Renomear pasta "${pasta}" para:`, pasta)
  if (!novo || novo === pasta) return
  api('/bellinha/docs/renomear', { method: 'POST', body: JSON.stringify({ de: pasta, para: novo.trim(), tipo: 'pasta' }) })
    .then(() => carregarDocs())
}

// Modal novo doc / nova pasta
function modalNovoDoc() {
  treinoModalModo = 'doc'
  $('treino-modal-titulo').textContent = 'Novo documento'
  $('treino-modal-pasta-wrap').style.display = 'block'
  $('treino-modal-label').textContent = 'Nome do documento'
  $('treino-modal-pasta').value = ''
  $('treino-modal-nome').value = ''
  mostrarErro('erro-modal-treino', '')
  $('treino-modal-bg').classList.add('open')
  setTimeout(() => $('treino-modal-pasta').focus(), 50)
}

function modalNovaPasta() {
  treinoModalModo = 'pasta'
  $('treino-modal-titulo').textContent = 'Nova pasta'
  $('treino-modal-pasta-wrap').style.display = 'none'
  $('treino-modal-label').textContent = 'Nome da pasta'
  $('treino-modal-nome').value = ''
  mostrarErro('erro-modal-treino', '')
  $('treino-modal-bg').classList.add('open')
  setTimeout(() => $('treino-modal-nome').focus(), 50)
}

function fecharModalTreino(e) {
  if (e && e.target !== $('treino-modal-bg')) return
  $('treino-modal-bg').classList.remove('open')
}

async function confirmarModalTreino() {
  mostrarErro('erro-modal-treino', '')
  if (treinoModalModo === 'pasta') {
    const nome = $('treino-modal-nome').value.trim()
    if (!nome) return mostrarErro('erro-modal-treino', 'Informe o nome da pasta')
    // Cria um placeholder vazio só para abrir a pasta; doc real vem depois
    $('treino-modal-bg').classList.remove('open')
    // Abre modal de novo doc já com a pasta preenchida
    treinoModalModo = 'doc'
    $('treino-modal-titulo').textContent = 'Novo documento'
    $('treino-modal-pasta-wrap').style.display = 'block'
    $('treino-modal-label').textContent = 'Nome do documento'
    $('treino-modal-pasta').value = nome
    $('treino-modal-nome').value = ''
    $('treino-modal-bg').classList.add('open')
    setTimeout(() => $('treino-modal-nome').focus(), 50)
    return
  }

  // Modo doc
  const pasta = $('treino-modal-pasta').value.trim()
  const nome = $('treino-modal-nome').value.trim()
  if (!nome) return mostrarErro('erro-modal-treino', 'Informe o nome do documento')

  const partes = [pasta, nome + '.txt'].filter(Boolean)
  const arquivo = partes.join('/')
  $('treino-modal-bg').classList.remove('open')

  // Abre editor em branco para o novo doc
  treinoArquivoAtivo = arquivo
  // Garante que pasta exista localmente para renderizar imediatamente
  const pastaNome = pasta || '(raiz)'
  if (!treinoPastas[pastaNome]) treinoPastas[pastaNome] = []
  const jaExiste = treinoPastas[pastaNome].some(d => d.arquivo === arquivo)
  if (!jaExiste) treinoPastas[pastaNome].push({ arquivo, nome, chunks: 0, preview: '' })
  renderizarArvore()

  $('treino-doc-nome').value = nome
  $('treino-doc-conteudo').value = ''
  $('treino-doc-info').textContent = 'Novo documento'
  mostrarErro('ok-treino', '')
  mostrarErro('erro-treino', '')
  $('treino-editor-content').style.display = 'flex'
  document.querySelector('.treino-editor-empty').style.display = 'none'
  $('treino-doc-conteudo').focus()
}

// ── Empreendimentos ───────────────────────────────

let empreendimentos = []

const EMP_STATUS_LABEL = { lancamento: 'Lançamento', em_obras: 'Em obras', pronto: 'Pronto' }

async function carregarEmpreendimentos() {
  try {
    const r = await api('/crm/empreendimentos')
    if (!r.ok) return
    empreendimentos = await r.json()
    renderizarEmpreendimentos()
    carregarEmpreendimentosSelect()
  } catch (e) { console.error('Erro ao carregar empreendimentos:', e) }
}

async function salvarEmpreendimento(e) {
  e.preventDefault()
  const nome = $('emp-nome').value.trim()
  if (!nome) return
  const btn = e.submitter
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...' }
  try {
    const r = await api('/crm/empreendimentos', {
      method: 'POST',
      body: JSON.stringify({ nome, tipo: $('emp-tipo').value.trim(), status: $('emp-status').value })
    })
    if (!r.ok) { const d = await r.json(); alert(d.erro || 'Erro ao salvar'); return }
    $('emp-nome').value = ''; $('emp-tipo').value = ''; $('emp-status').value = ''
    await carregarEmpreendimentos()
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Cadastrar' }
  }
}

async function deletarEmpreendimento(id) {
  if (!confirm('Remover este empreendimento?')) return
  const r = await api(`/crm/empreendimentos/${id}`, { method: 'DELETE' })
  if (!r.ok) { const d = await r.json(); alert(d.erro || 'Erro ao remover'); return }
  await carregarEmpreendimentos()
}

function renderizarEmpreendimentos() {
  const tbody = $('emp-tbody')
  const vazio = $('emp-vazio')
  const tabela = $('emp-tabela')
  if (!tbody) return
  if (!empreendimentos.length) {
    tabela.style.display = 'none'
    vazio.style.display = 'block'
    return
  }
  tabela.style.display = ''
  vazio.style.display = 'none'
  tbody.innerHTML = empreendimentos.map(e => `<tr>
    <td style="font-weight:500">${esc(e.nome)}</td>
    <td style="color:var(--text-muted)">${esc(e.tipo || '—')}</td>
    <td>${e.status ? `<span class="tag tag-${e.status}">${EMP_STATUS_LABEL[e.status] || e.status}</span>` : '—'}</td>
    <td style="text-align:right;display:flex;gap:8px;justify-content:flex-end">
      <button onclick="abrirEmpEdit('${e.id}')" style="width:auto;padding:5px 14px;font-size:12px">Editar</button>
      <button onclick="deletarEmpreendimento('${e.id}')" style="width:auto;padding:5px 10px;font-size:12px;background:transparent;color:#d95a5a;border:1.5px solid rgba(217,90,90,0.28);box-shadow:none">Remover</button>
    </td>
  </tr>`).join('')
}

function carregarEmpreendimentosSelect() {
  const dl = $('emp-datalist')
  if (!dl) return
  dl.innerHTML = empreendimentos.map(e => `<option value="${esc(e.nome)}">`).join('')
}

// ── CRM Kanban ────────────────────────────────────

const CRM_COLS = [
  { id: 'novo',              label: 'Novo Lead',            cor: '#7A8C5F' },
  { id: 'tentativa',         label: 'Tentativa de Contato', cor: '#4A8FA8' },
  { id: 'atendimento',       label: 'Atendimento',          cor: '#9B7FC2' },
  { id: 'visita_marcada',    label: 'Visita Marcada',       cor: '#D4883A' },
  { id: 'visita_feita',      label: 'Visita Realizada',     cor: '#C2873A' },
  { id: 'terreno_reservado', label: 'Terreno Reservado',    cor: '#8B6914' },
  { id: 'fechamento',        label: 'Fechamento',           cor: '#3AAD5E' },
]

let crmCards = []
let crmColAtiva = 'novo'
let crmDragId = null
let crmEditId = null

async function carregarLeads() {
  try {
    const r = await api('/crm/leads')
    if (!r.ok) return
    crmCards = await r.json()
  } catch (e) { console.error('Erro ao carregar leads:', e) }
}

function renderizarKanban() {
  const board = $('kanban-board')
  if (!board) return
  board.innerHTML = CRM_COLS.map(col => {
    const cards = crmCards.filter(c => c.coluna === col.id && !c.arquivado)
    return `
      <div class="kanban-col" data-col="${col.id}">
        <div class="kanban-col-header">
          <span class="kanban-col-title">
            <span class="kanban-col-dot" style="background:${col.cor}"></span>
            ${esc(col.label)}
          </span>
          <span class="kanban-col-count">${cards.length}</span>
        </div>
        <div class="kanban-cards" id="col-${col.id}"
          ondragover="crmDragOver(event)"
          ondragleave="crmDragLeave(event)"
          ondrop="crmDrop(event,'${col.id}')">
          ${cards.map(c => crmCardHtml(c)).join('')}
        </div>
        <button class="kanban-add-btn" onclick="abrirModalCrm('${col.id}')">
          <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z"/></svg>
          Adicionar cliente
        </button>
      </div>`
  }).join('')
}

function crmCardHtml(c) {
  const corretorInitials = c.corretor ? c.corretor.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase() : ''

  const tagColor = c.status_venda === 'convertido' ? '#22C55E'
                 : c.status_venda === 'perdido'    ? '#d95a5a'
                 : '#4A8FA8'
  const tagLabel = c.produto_negociacao || (c.status_venda === 'convertido' ? 'Convertido' : c.status_venda === 'perdido' ? 'Perdido' : null)

  let dateStr = ''
  if (c.data_ultimo_contato) {
    const d = new Date(c.data_ultimo_contato + 'T12:00:00')
    dateStr = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
  }

  const svgCal = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" width="11" height="11"><rect x="1" y="2.5" width="12" height="10" rx="2"/><path d="M4.5 1v3M9.5 1v3M1 6h12"/></svg>`
  const svgPhone = `<svg viewBox="0 0 14 14" fill="currentColor" width="11" height="11"><path d="M3.1 5.3c.7 1.3 1.8 2.5 3.1 3.1l1-1c.2-.1.4-.1.5 0 .5.2 1 .3 1.6.3.3 0 .6.2.6.5v1.6c0 .3-.2.5-.5.5C4 10.3 1 7.3 1 3.5c0-.3.2-.5.5-.5H3c.3 0 .5.2.5.5 0 .6.1 1.1.3 1.6.1.2 0 .4-.1.5L3.1 5.3z"/></svg>`
  const svgVal = `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" width="11" height="11"><circle cx="7" cy="7" r="5.5"/><path d="M7 4v6M5 5.5h2.5a1.5 1.5 0 010 3H5"/></svg>`

  return `
    <div class="kanban-card" id="card-${c.id}" draggable="true"
      onclick="abrirLeadModal('${c.id}')"
      ondragstart="crmDragStart(event,'${c.id}')"
      ondragend="crmDragEnd(event)">
      <button class="kanban-card-delete" onclick="event.stopPropagation();deletarCardCrm('${c.id}')" title="Remover">×</button>
      ${tagLabel ? `<div class="kcard-tag" style="background:${tagColor}18;color:${tagColor}">${esc(tagLabel)}</div>` : ''}
      <div class="kcard-title">${esc(c.nome)}</div>
      <div class="kcard-footer">
        <div class="kcard-meta">
          ${dateStr ? `<span class="kcard-meta-item">${svgCal} ${dateStr}</span>` : ''}
          ${c.telefone ? `<span class="kcard-meta-item">${svgPhone}</span>` : ''}
          ${c.valor_negociacao ? `<span class="kcard-meta-item">${svgVal} ${esc(c.valor_negociacao)}</span>` : ''}
        </div>
        ${corretorInitials ? `<div class="kcard-avatar">${corretorInitials}</div>` : ''}
      </div>
    </div>`
}

function abrirModalCrm(colId) {
  crmColAtiva = colId
  crmEditId = null
  $('crm-modal-titulo').textContent = 'Novo lead'
  $('crm-nome').value = ''
  $('crm-telefone').value = ''
  $('crm-corretor').value = ''
  $('crm-modal-bg').classList.add('open')
  carregarCorretoresSelect()
  setTimeout(() => $('crm-nome').focus(), 50)
}

function fecharModalCrm(e) {
  if (e && e.target !== $('crm-modal-bg')) return
  $('crm-modal-bg').classList.remove('open')
}

async function salvarCardCrm() {
  const nome = $('crm-nome').value.trim()
  if (!nome) { $('crm-nome').focus(); return }
  const corretorVal = ($('crm-corretor').value || '').split(',')
  const r = await api('/crm/leads', {
    method: 'POST',
    body: JSON.stringify({
      nome,
      telefone: $('crm-telefone').value.trim(),
      coluna: crmColAtiva,
      corretor: corretorVal[0] || '',
      corretor_numero: corretorVal[1] || '',
      data_cadastro: new Date().toISOString(),
    })
  })
  if (!r.ok) { const d = await r.json(); alert(d.erro || 'Erro ao criar lead'); return }
  $('crm-modal-bg').classList.remove('open')
  await carregarLeads()
  renderizarKanban()
}

async function deletarCardCrm(id) {
  const r = await api(`/crm/leads/${id}`, { method: 'DELETE' })
  if (!r.ok) return
  crmCards = crmCards.filter(c => c.id !== id)
  renderizarKanban()
  renderizarClientes()
}

async function arquivarCardCrm(id) {
  const card = crmCards.find(c => c.id === id)
  if (!card) return
  const arquivado = !card.arquivado
  const r = await api(`/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify({ arquivado }) })
  if (!r.ok) return
  card.arquivado = arquivado
  renderizarKanban()
  renderizarClientes()
}

// ── CRM Clientes ──────────────────────────────────

let clientesFiltro = 'todos'

const CRM_COL_LABEL = Object.fromEntries(CRM_COLS.map(c => [c.id, { label: c.label, cor: c.cor }]))

function filtrarClientes(filtro) {
  clientesFiltro = filtro
  document.querySelectorAll('.clientes-filtro').forEach(b => b.classList.toggle('active', b.dataset.filtro === filtro))
  renderizarClientes()
}

function renderizarClientes() {
  const busca = ($('clientes-busca')?.value || '').toLowerCase()
  let lista = [...crmCards]
  if (clientesFiltro === 'ativo') lista = lista.filter(c => !c.arquivado)
  if (clientesFiltro === 'arquivado') lista = lista.filter(c => c.arquivado)
  if (busca) lista = lista.filter(c => c.nome.toLowerCase().includes(busca) || (c.telefone || '').includes(busca) || (c.email || '').includes(busca))

  const tbody = $('clientes-tbody')
  const vazio = $('clientes-vazio')
  const tabela = $('clientes-tabela')
  if (!tbody) return

  if (!lista.length) {
    tbody.innerHTML = ''
    tabela.style.display = 'none'
    vazio.style.display = 'block'
    return
  }
  tabela.style.display = ''
  vazio.style.display = 'none'

  tbody.innerHTML = lista.map(c => {
    const col = CRM_COL_LABEL[c.coluna] || { label: c.coluna, cor: '#8C8880' }
    const arquivado = c.arquivado
    const statusColor = c.status_venda === 'convertido' ? '#22C55E' : c.status_venda === 'perdido' ? '#d95a5a' : '#C97A1A'
    const statusLabel = c.status_venda === 'convertido' ? 'Convertido' : c.status_venda === 'perdido' ? 'Perdido' : 'Em andamento'
    const tel = (c.telefone || '').replace(/\D/g, '')
    return `<tr>
      <td style="font-weight:500;cursor:pointer;color:var(--accent)" onclick="abrirLeadModal('${c.id}')" title="Abrir ficha">${esc(c.nome)}</td>
      <td style="color:var(--text-muted)">
        ${c.telefone ? `<a href="https://wa.me/55${tel}" target="_blank" style="text-decoration:none;color:inherit;display:inline-flex;align-items:center;gap:4px">📱 ${esc(c.telefone)}</a>` : '—'}
      </td>
      <td style="color:var(--text-muted);font-size:13px">${esc(c.email || '—')}</td>
      <td style="color:var(--text-muted);font-size:13px">${esc(c.corretor || '—')}</td>
      <td style="color:var(--text-muted);font-size:13px">${esc(c.produto_negociacao || '—')}</td>
      <td><span class="tag" style="background:${col.cor}22;color:${col.cor};border-color:${col.cor}33">${esc(col.label)}</span></td>
      <td>${c.status_venda ? `<span class="tag" style="background:${statusColor}22;color:${statusColor};border-color:${statusColor}33">${statusLabel}</span>` : '—'}</td>
      <td style="color:var(--accent);font-weight:500">${c.valor_negociacao ? 'R$ ' + esc(c.valor_negociacao) : '—'}</td>
      <td style="color:var(--text-muted);font-size:12px">${c.data_ultimo_contato ? c.data_ultimo_contato.split('T')[0] : '—'}</td>
      <td style="white-space:nowrap;text-align:right">
        <button onclick="abrirLeadModal('${c.id}')" style="width:auto;padding:5px 10px;font-size:12px;background:transparent;color:var(--accent);border:1.5px solid rgba(122,140,95,0.3);box-shadow:none;margin-right:4px" title="Editar">✏</button>
        <button onclick="arquivarCardCrm('${c.id}')" style="width:auto;padding:5px 12px;font-size:12px;background:transparent;color:var(--text-muted);border:1.5px solid var(--border);box-shadow:none" title="${arquivado ? 'Reativar' : 'Arquivar'}">${arquivado ? 'Reativar' : 'Arquivar'}</button>
        <button onclick="deletarCardCrm('${c.id}');renderizarClientes()" style="width:auto;padding:5px 10px;font-size:12px;background:transparent;color:#d95a5a;border:1.5px solid rgba(217,90,90,0.28);box-shadow:none;margin-left:4px" title="Excluir">Excluir</button>
      </td>
    </tr>`
  }).join('')
}

// Drag & drop
function crmDragStart(e, id) {
  crmDragId = id
  e.dataTransfer.effectAllowed = 'move'
  setTimeout(() => { const el = document.getElementById('card-' + id); if (el) el.classList.add('dragging') }, 0)
}
function crmDragEnd(e) {
  document.querySelectorAll('.kanban-card').forEach(el => el.classList.remove('dragging'))
}
function crmDragOver(e) {
  e.preventDefault()
  e.currentTarget.classList.add('drag-over')
}
function crmDragLeave(e) {
  e.currentTarget.classList.remove('drag-over')
}
async function crmDrop(e, colId) {
  e.preventDefault()
  e.currentTarget.classList.remove('drag-over')
  if (!crmDragId) return
  const card = crmCards.find(c => c.id === crmDragId)
  const id = crmDragId
  crmDragId = null
  if (!card || card.coluna === colId) return
  card.coluna = colId
  renderizarKanban()
  await api(`/crm/leads/${id}`, { method: 'PUT', body: JSON.stringify({ coluna: colId }) })
}

// ── Lead Modal (detalhe/edição) ──────────────────

let leadEditId = null

async function carregarCorretoresSelect() {
  try {
    const res = await fetch('/usuarios/corretores', { headers: { 'x-token': sessionStorage.getItem('dash_token') } })
    if (!res.ok) return
    const corretores = await res.json()
    const selects = [$('crm-corretor'), $('lead-corretor')].filter(Boolean)
    selects.forEach(sel => {
      const val = sel.value
      sel.innerHTML = '<option value="">Selecionar corretor...</option>' + corretores.map(c => `<option value="${esc(c.nome)},${esc(c.numero)}">${esc(c.nome)}</option>`).join('')
      sel.value = val
    })
  } catch (e) { console.error('Erro ao carregar corretores:', e) }
}

function popularSelectEtapas() {
  const sel = $('lead-coluna')
  if (!sel || sel.options.length > 1) return
  CRM_COLS.forEach(c => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.label
    sel.appendChild(opt)
  })
}

function atualizarAvatarLg() {
  const nome = ($('lead-nome').value || '').trim()
  const av = $('lead-avatar-lg')
  if (!av) return
  const parts = nome.split(/\s+/).filter(Boolean)
  if (parts.length === 0) {
    av.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>'
    av.classList.remove('has-initials')
  } else {
    const initials = parts.slice(0, 2).map(w => w[0].toUpperCase()).join('')
    av.textContent = initials
    av.classList.add('has-initials')
  }
}

function atualizarInfoBar() {
  const tel = ($('lead-telefone').value || '').trim()
  const email = ($('lead-email').value || '').trim()
  const produto = ($('lead-produto-negociacao').value || '').trim()
  const dataContato = ($('lead-data-ultimo-contato').value || '').trim()
  const phoneEl = $('lead-info-phone')
  const emailEl = $('lead-info-email')
  const produtoEl = $('lead-info-produto')
  const contatoEl = $('lead-info-contato')
  if (phoneEl) phoneEl.textContent = tel || '—'
  if (emailEl) emailEl.textContent = email || '—'
  if (produtoEl) produtoEl.textContent = produto || '—'
  if (contatoEl) {
    if (dataContato) {
      const d = new Date(dataContato + 'T12:00:00')
      contatoEl.textContent = d.toLocaleDateString('pt-BR', { weekday: 'long' })
    } else {
      contatoEl.textContent = '—'
    }
  }
}

function abrirLeadModal(id) {
  leadEditId = id
  const card = crmCards.find(c => c.id === id)
  if (!card) return

  popularSelectEtapas()
  carregarCorretoresSelect()
  carregarEmpreendimentosSelect()

  $('lead-nome').value = card.nome || ''
  $('lead-telefone').value = card.telefone || ''
  $('lead-email').value = card.email || ''
  $('lead-coluna').value = card.coluna || ''
  $('lead-corretor').value = (card.corretor && card.corretor_numero) ? `${card.corretor},${card.corretor_numero}` : ''
  $('lead-produto-negociacao').value = card.produto_negociacao || ''
  $('lead-produto-origem').value = card.produto_origem || ''
  $('lead-campanha-origem').value = card.campanha_origem || ''
  $('lead-valor').value = card.valor_negociacao || ''
  $('lead-status-venda').value = card.status_venda || ''
  $('lead-motivo-perda').value = card.motivo_perda || ''
  $('lead-data-cadastro').value = card.data_cadastro ? card.data_cadastro.split('T')[0] : ''
  $('lead-data-ultimo-contato').value = card.data_ultimo_contato ? card.data_ultimo_contato.split('T')[0] : ''
  $('lead-documentos').value = card.documentos || ''
  $('lead-anotacoes').value = card.anotacoes || ''

  atualizarAvatarLg()
  atualizarInfoBar()
  atualizarBadgeEtapa()
  renderizarLifecycle()
  atualizarVisibilidadeMotivo()
  atualizarBotoesContato()

  $('lead-modal-bg').classList.add('open')
}

function fecharLeadModal(e) {
  if (e && e.target.closest?.('.lead-panel')) return
  $('lead-modal-bg').classList.remove('open')
  leadEditId = null
}

function atualizarBadgeEtapa() {
  const colId = $('lead-coluna').value
  const col = CRM_COLS.find(c => c.id === colId)
  const badge = $('lead-etapa-badge')
  if (col) {
    badge.textContent = col.label
    badge.style.background = col.cor + '22'
    badge.style.color = col.cor
    badge.style.borderColor = col.cor + '33'
    badge.style.border = '1px solid'
  } else {
    badge.textContent = '—'
    badge.style.background = ''
    badge.style.color = ''
  }
  renderizarLifecycle()
}

function renderizarLifecycle() {
  const lc = $('lead-lifecycle')
  if (!lc) return
  const colId = $('lead-coluna').value
  const currentIdx = CRM_COLS.findIndex(c => c.id === colId)
  lc.innerHTML = CRM_COLS.map((col, i) => {
    const done = i < currentIdx
    const active = i === currentIdx
    const cls = done ? 'lc-step done' : active ? 'lc-step active' : 'lc-step'
    return `<div class="${cls}" style="${active ? `--lc-cor:${col.cor}` : ''}" onclick="setLeadEtapa('${col.id}')">
      ${done ? `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><polyline points="2 8 6 12 14 4"/></svg>` : ''}
      <span>${col.label}</span>
    </div>`
  }).join('<span class="lc-arrow">›</span>')
}

function setLeadEtapa(colId) {
  $('lead-coluna').value = colId
  atualizarBadgeEtapa()
}

function atualizarVisibilidadeMotivo() {
  const status = $('lead-status-venda').value
  $('lead-motivo-wrap').style.display = status === 'perdido' ? 'block' : 'none'
}

function atualizarBotoesContato() {
  const tel = ($('lead-telefone').value || '').replace(/\D/g, '')
  const corretor_numero = ($('lead-corretor').value || '').split(',')[1] || ''
  const wa_numero = corretor_numero || tel
  $('lead-whatsapp-btn').href = wa_numero ? `https://wa.me/55${wa_numero}` : '#'
  $('lead-tel-btn').href = tel ? `tel:${tel}` : '#'
  atualizarInfoBar()
}

async function salvarLead() {
  const nome = $('lead-nome').value.trim()
  if (!nome) { $('lead-nome').focus(); return }

  const corretorVal = $('lead-corretor').value.split(',')
  const payload = {
    nome,
    telefone: $('lead-telefone').value.trim(),
    email: $('lead-email').value.trim(),
    coluna: $('lead-coluna').value || 'novo',
    corretor: corretorVal[0] || '',
    corretor_numero: corretorVal[1] || '',
    produto_negociacao: $('lead-produto-negociacao').value.trim(),
    produto_origem: $('lead-produto-origem').value.trim(),
    campanha_origem: $('lead-campanha-origem').value.trim(),
    valor_negociacao: $('lead-valor').value.trim(),
    status_venda: $('lead-status-venda').value || '',
    motivo_perda: $('lead-motivo-perda').value.trim(),
    data_cadastro: $('lead-data-cadastro').value ? new Date($('lead-data-cadastro').value).toISOString() : new Date().toISOString(),
    data_ultimo_contato: $('lead-data-ultimo-contato').value || null,
    documentos: $('lead-documentos').value.trim(),
    anotacoes: $('lead-anotacoes').value.trim(),
  }

  const r = await api(`/crm/leads/${leadEditId}`, { method: 'PUT', body: JSON.stringify(payload) })
  if (!r.ok) { const d = await r.json(); alert(d.erro || 'Erro ao salvar'); return }

  const updated = await r.json()
  const idx = crmCards.findIndex(c => c.id === leadEditId)
  if (idx !== -1) crmCards[idx] = updated

  fecharLeadModal()
  renderizarKanban()
  renderizarClientes()
}

// ── Trocar senha ──────────────────────────────────

async function trocarSenha() {
  const senha_atual = $('cfg-senha-atual').value
  const nova_senha = $('cfg-nova-senha').value
  const confirmar = $('cfg-confirmar-senha').value
  limparMensagens('erro-cfg', 'ok-cfg')
  if (!senha_atual || !nova_senha) return mostrarErro('erro-cfg', 'Preencha todos os campos')
  if (nova_senha !== confirmar) return mostrarErro('erro-cfg', 'As senhas não coincidem')
  setCarregando('btn-trocar', true, 'Salvar nova senha')

  const r = await api('/auth/trocar-senha', { method: 'POST', body: JSON.stringify({ senha_atual, nova_senha }) })
  const data = await r.json()
  setCarregando('btn-trocar', false, 'Salvar nova senha')
  if (!r.ok) return mostrarErro('erro-cfg', data.erro || 'Erro ao trocar senha')

  $('cfg-senha-atual').value = ''; $('cfg-nova-senha').value = ''; $('cfg-confirmar-senha').value = ''
  mostrarErro('ok-cfg', 'Senha alterada com sucesso!')
}

// ── Lead panel resize ─────────────────────────────

;(function() {
  let resizing = false, startX = 0, startW = 0
  document.addEventListener('mousedown', e => {
    const handle = e.target.closest('#lead-resize-handle')
    if (!handle) return
    const panel = $('lead-panel')
    if (!panel) return
    resizing = true
    startX = e.clientX
    startW = panel.offsetWidth
    handle.classList.add('dragging')
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })
  document.addEventListener('mousemove', e => {
    if (!resizing) return
    const panel = $('lead-panel')
    if (!panel) return
    const delta = startX - e.clientX
    const newW = Math.min(860, Math.max(320, startW + delta))
    panel.style.width = newW + 'px'
  })
  document.addEventListener('mouseup', () => {
    if (!resizing) return
    resizing = false
    const handle = $('lead-resize-handle')
    if (handle) handle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })
})()

// ── Empreendimento Edit Panel ─────────────────────

let empEditId = null
let empDocsAtivos = {}
let empDocAtivo = null

async function abrirEmpEdit(id) {
  const emp = empreendimentos.find(e => e.id === id)
  if (!emp) return
  empEditId = id
  empDocAtivo = null

  $('emp-edit-nome').value = emp.nome
  $('emp-edit-tipo').value = emp.tipo || ''
  $('emp-edit-status').value = emp.status || ''
  $('emp-edit-title').textContent = emp.nome

  $('emp-edit-bg').classList.add('open')
  await carregarDocsEmp(emp.nome)
}

function fecharEmpEdit(e) {
  if (e && e.target.closest?.('.emp-edit-panel')) return
  $('emp-edit-bg').classList.remove('open')
  empEditId = null
}

async function salvarEmpEdit(e) {
  e.preventDefault()
  const nome = $('emp-edit-nome').value.trim()
  if (!nome) return
  const btn = e.submitter
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...' }
  try {
    const r = await api(`/crm/empreendimentos/${empEditId}`, {
      method: 'PUT',
      body: JSON.stringify({ nome, tipo: $('emp-edit-tipo').value.trim(), status: $('emp-edit-status').value })
    })
    if (!r.ok) { const d = await r.json(); alert(d.erro || 'Erro ao salvar'); return }
    $('emp-edit-title').textContent = nome
    await carregarEmpreendimentos()
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar' }
  }
}

async function carregarDocsEmp(pasta) {
  try {
    const r = await api('/bellinha/docs')
    if (!r.ok) return
    const todos = await r.json()
    empDocsAtivos = todos[pasta] ? { [pasta]: todos[pasta] } : {}
    renderizarArvoreEmp(pasta)
  } catch (e) { console.error('Erro ao carregar docs:', e) }
}

function renderizarArvoreEmp(pasta) {
  const arvore = $('emp-treino-arvore')
  if (!arvore) return
  const docs = empDocsAtivos[pasta] || []
  if (!docs.length) {
    arvore.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:10px">Nenhum documento ainda. Clique em + Novo para começar.</p>'
    return
  }
  arvore.innerHTML = docs.map(d => `
    <div class="treino-doc-item${empDocAtivo === d.arquivo ? ' active' : ''}" onclick="abrirDocEmp('${esc(d.arquivo)}')" data-arquivo="${esc(d.arquivo)}">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.nome)}</span>
      <button class="treino-doc-delete" onclick="event.stopPropagation();deletarDocEmp('${esc(d.arquivo)}')" title="Excluir">×</button>
    </div>`).join('')
}

async function abrirDocEmp(arquivo) {
  empDocAtivo = arquivo
  const emp = empreendimentos.find(e => e.id === empEditId)
  if (emp) renderizarArvoreEmp(emp.nome)

  $('emp-treino-doc-nome').value = arquivo.split('/').pop().replace(/\.txt$/, '')
  $('emp-treino-doc-conteudo').value = 'Carregando...'
  $('emp-treino-editor-content').style.display = 'flex'
  $('emp-treino-editor-empty').style.display = 'none'

  const r = await api('/bellinha/docs/conteudo?arquivo=' + encodeURIComponent(arquivo))
  if (!r.ok) { $('emp-treino-doc-conteudo').value = ''; return }
  const data = await r.json()
  $('emp-treino-doc-conteudo').value = data.conteudo
}

async function salvarDocEmp() {
  if (!empDocAtivo) return
  const conteudo = $('emp-treino-doc-conteudo').value.trim()
  const novoNome = $('emp-treino-doc-nome').value.trim()
  if (!conteudo) return
  const btn = $('btn-salvar-doc-emp')
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...' }

  const partes = empDocAtivo.split('/')
  const nomAtual = partes[partes.length - 1].replace(/\.txt$/, '')
  let arquivoFinal = empDocAtivo
  if (novoNome && novoNome !== nomAtual) {
    partes[partes.length - 1] = novoNome + '.txt'
    arquivoFinal = partes.join('/')
    await api('/bellinha/docs/renomear', { method: 'POST', body: JSON.stringify({ de: empDocAtivo, para: arquivoFinal, tipo: 'doc' }) })
    empDocAtivo = arquivoFinal
  }

  const r = await api('/bellinha/docs/conteudo', { method: 'PUT', body: JSON.stringify({ arquivo: arquivoFinal, conteudo }) })
  if (btn) { btn.disabled = false; btn.textContent = 'Salvar e reindexar' }
  if (r.ok) {
    const emp = empreendimentos.find(e => e.id === empEditId)
    if (emp) await carregarDocsEmp(emp.nome)
  }
}

async function novoDocEmp() {
  const emp = empreendimentos.find(e => e.id === empEditId)
  if (!emp) return
  const nome = prompt('Nome do documento:')
  if (!nome) return
  const arquivo = emp.nome + '/' + nome.trim() + '.txt'
  empDocAtivo = arquivo
  $('emp-treino-doc-nome').value = nome.trim()
  $('emp-treino-doc-conteudo').value = ''
  $('emp-treino-editor-content').style.display = 'flex'
  $('emp-treino-editor-empty').style.display = 'none'
  $('emp-treino-doc-conteudo').focus()
}

async function deletarDocEmp(arquivo) {
  if (!confirm(`Excluir "${arquivo}"?`)) return
  await api('/bellinha/docs/' + encodeURIComponent(arquivo), { method: 'DELETE' })
  if (empDocAtivo === arquivo) {
    empDocAtivo = null
    $('emp-treino-editor-content').style.display = 'none'
    $('emp-treino-editor-empty').style.display = 'flex'
  }
  const emp = empreendimentos.find(e => e.id === empEditId)
  if (emp) await carregarDocsEmp(emp.nome)
}

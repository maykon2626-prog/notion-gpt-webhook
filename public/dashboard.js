let tokenAtual = sessionStorage.getItem('dash_token') || ''
let graficoHoras = null

// ── Helpers ──────────────────────────────────────

function $(id) { return document.getElementById(id) }
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

if (localStorage.getItem('sidebar-collapsed') === 'true') {
  document.body.classList.add('sidebar-collapsed')
}

function toggleSidebar() {
  if (window.innerWidth <= 768) {
    fecharSidebar()
  } else {
    const collapsed = document.body.classList.toggle('sidebar-collapsed')
    localStorage.setItem('sidebar-collapsed', collapsed)
  }
}

function abrirSidebar() {
  $('sidebar').classList.add('open')
  $('sidebar-overlay').classList.add('open')
}

function fecharSidebar() {
  $('sidebar').classList.remove('open')
  $('sidebar-overlay').classList.remove('open')
}

// ── Navegação ─────────────────────────────────────

function navegarPara(pagina) {
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'))
  document.querySelector(`[data-pagina="${pagina}"]`).classList.add('active')
  document.querySelectorAll('#conteudo > div[id^="pagina-"]').forEach(el => el.style.display = 'none')
  $(`pagina-${pagina}`).style.display = 'block'
  if (pagina === 'usuarios') carregarUsuarios()
  if (window.innerWidth <= 768) fecharSidebar()
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

async function abrirApp() {
  const r = await api('/analytics')
  if (r.status === 401) { sessionStorage.removeItem('dash_token'); tokenAtual = ''; return }
  const data = await r.json()
  $('login').style.display = 'none'
  $('app').style.display = 'flex'
  renderizar(data)
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
      <td>${i + 1}</td><td>${c.nome}</td>
      <td><a href="https://wa.me/${c.telefone}" target="_blank" style="color:#7A8C5F;text-decoration:none;font-size:13px">📱 ${c.telefone}</a></td>
      <td><span class="tag">${c.tipo}</span></td><td>${c.mensagens}</td>
    </tr>`).join('')

  const maxImob = Math.max(...d.por_imobiliaria.map(i => i.count), 1)
  $('imob-list').innerHTML = d.por_imobiliaria.map(i => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>${i.label}</span>
        <span style="color:#8C8880">${i.corretores} corretor${i.corretores !== 1 ? 'es' : ''} · ${i.count} msgs</span>
      </div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(i.count / maxImob * 100)}%"></div></div>
    </div>`).join('')

  const maxProd = Math.max(...Object.values(d.por_produto), 1)
  $('prod-list').innerHTML = Object.entries(d.por_produto).sort((a, b) => b[1] - a[1]).map(([k, v]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px"><span>${k}</span><span>${v}</span></div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(v / maxProd * 100)}%"></div></div>
    </div>`).join('')

  $('lacunas-list').innerHTML = d.lacunas_pendentes.length
    ? d.lacunas_pendentes.map(l => `<div class="lacuna">❓ ${l.pergunta}</div>`).join('')
    : '<p style="color:#8C8880;font-size:13px">Nenhuma lacuna pendente 🎉</p>'

  if (d.por_hora) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)
    if (graficoHoras) graficoHoras.destroy()
    graficoHoras = new Chart($('grafico-horas'), {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Mensagens', data: d.por_hora, backgroundColor: '#7A8C5F', borderRadius: 4 }] },
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
      <td>${u.nome || '<span style="color:#8C8880">—</span>'}</td>
      <td>📱 ${u.numero}</td>
      <td style="color:#8C8880;font-size:13px">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td><button class="btn-danger" onclick="removerUsuario('${u.numero}', this)">Remover</button></td>
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

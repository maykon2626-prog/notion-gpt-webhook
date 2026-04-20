let tokenAtual = sessionStorage.getItem('dash_token') || ''
let graficoHoras = null

// ── Helpers ──────────────────────────────────────

function mostrarErro(id, msg) {
  document.getElementById(id).textContent = msg
}

function setCarregando(btnId, carregando, textoOriginal) {
  const btn = document.getElementById(btnId)
  btn.disabled = carregando
  btn.textContent = carregando ? 'Aguarde...' : textoOriginal
}

function api(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-token': tokenAtual, ...(opts.headers || {}) }
  })
}

// ── Navegação ─────────────────────────────────────

function navegarPara(pagina) {
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'))
  document.querySelector(`[data-pagina="${pagina}"]`).classList.add('active')
  document.querySelectorAll('#conteudo > div[id^="pagina-"]').forEach(el => el.style.display = 'none')
  document.getElementById(`pagina-${pagina}`).style.display = 'block'
  if (pagina === 'usuarios') carregarUsuarios()
}

// ── Login ─────────────────────────────────────────

function mostrarErroLogin(msg) { mostrarErro('erro', msg) }

async function solicitarCodigo() {
  const numero = document.getElementById('input-telefone').value.trim()
  if (!numero) return mostrarErroLogin('Informe o número de WhatsApp')
  mostrarErroLogin('')
  setCarregando('btn-enviar', true, 'Enviar código')
  const r = await fetch('/auth/solicitar-codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero })
  })
  const data = await r.json()
  setCarregando('btn-enviar', false, 'Enviar código')
  if (!r.ok) return mostrarErroLogin(data.erro || 'Erro ao enviar código')
  document.getElementById('passo-telefone').style.display = 'none'
  document.getElementById('passo-codigo').style.display = 'block'
  document.getElementById('input-codigo').focus()
}

async function verificarCodigo() {
  const numero = document.getElementById('input-telefone').value.trim()
  const codigo = document.getElementById('input-codigo').value.trim()
  if (!codigo) return mostrarErroLogin('Informe o código recebido')
  mostrarErroLogin('')
  setCarregando('btn-verificar', true, 'Verificar')
  const r = await fetch('/auth/verificar-codigo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero, codigo })
  })
  const data = await r.json()
  setCarregando('btn-verificar', false, 'Verificar')
  if (!r.ok) return mostrarErroLogin(data.erro || 'Código inválido')
  tokenAtual = data.token
  sessionStorage.setItem('dash_token', tokenAtual)
  await abrirApp()
}

function voltarTelefone() {
  document.getElementById('passo-codigo').style.display = 'none'
  document.getElementById('passo-telefone').style.display = 'block'
  document.getElementById('input-codigo').value = ''
  mostrarErroLogin('')
}

async function abrirApp() {
  const r = await api('/analytics')
  if (r.status === 401) { sessionStorage.removeItem('dash_token'); tokenAtual = ''; return }
  const data = await r.json()
  document.getElementById('login').style.display = 'none'
  document.getElementById('app').style.display = 'flex'
  renderizar(data)
}

if (tokenAtual) abrirApp()

// ── Analytics ─────────────────────────────────────

async function filtrar() {
  const de = document.getElementById('f-de').value
  const ate = document.getElementById('f-ate').value
  const params = new URLSearchParams()
  if (de) params.append('de', de)
  if (ate) params.append('ate', ate)
  const url = '/analytics' + (params.toString() ? '?' + params.toString() : '')
  document.getElementById('f-label').textContent = de || ate ? `Filtrando: ${de || 'início'} → ${ate || 'hoje'}` : ''
  renderizar(await (await api(url)).json())
}

async function limparFiltro() {
  document.getElementById('f-de').value = ''
  document.getElementById('f-ate').value = ''
  document.getElementById('f-label').textContent = ''
  renderizar(await (await api('/analytics')).json())
}

function renderizar(d) {
  document.getElementById('total-corretores').textContent = d.total_corretores
  document.getElementById('total-mensagens').textContent = d.total_mensagens
  document.getElementById('total-lacunas').textContent = d.lacunas_pendentes.length
  document.getElementById('total-faqs').textContent = d.faqs_gerados.length

  document.getElementById('tb-corretores').innerHTML = d.por_corretor.slice(0, 10).map((c, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${c.nome}</td>
      <td><a href="https://wa.me/${c.telefone}" target="_blank" style="color:#7A8C5F;text-decoration:none;font-size:13px">📱 ${c.telefone}</a></td>
      <td><span class="tag">${c.tipo}</span></td>
      <td>${c.mensagens}</td>
    </tr>
  `).join('')

  const maxImob = Math.max(...d.por_imobiliaria.map(i => i.count), 1)
  document.getElementById('imob-list').innerHTML = d.por_imobiliaria.map(i => `
    <div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:13px">
        <span>${i.label}</span>
        <span style="color:#8C8880">${i.corretores} corretor${i.corretores !== 1 ? 'es' : ''} · ${i.count} msgs</span>
      </div>
      <div class="bar-wrap"><div class="bar" style="width:${Math.round(i.count / maxImob * 100)}%"></div></div>
    </div>
  `).join('')

  const maxProd = Math.max(...Object.values(d.por_produto), 1)
  document.getElementById('prod-list').innerHTML = Object.entries(d.por_produto)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:13px"><span>${k}</span><span>${v}</span></div>
        <div class="bar-wrap"><div class="bar" style="width:${Math.round(v / maxProd * 100)}%"></div></div>
      </div>
    `).join('')

  document.getElementById('lacunas-list').innerHTML = d.lacunas_pendentes.length
    ? d.lacunas_pendentes.map(l => `<div class="lacuna">❓ ${l.pergunta}</div>`).join('')
    : '<p style="color:#8C8880;font-size:13px">Nenhuma lacuna pendente 🎉</p>'

  if (d.por_hora) {
    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}h`)
    if (graficoHoras) graficoHoras.destroy()
    graficoHoras = new Chart(document.getElementById('grafico-horas'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{ label: 'Mensagens', data: d.por_hora, backgroundColor: '#7A8C5F', borderRadius: 4 }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } },
          x: { grid: { display: false } }
        }
      }
    })
  }

  if (d.tokens) {
    document.getElementById('tokens-entrada').textContent = d.tokens.entrada.toLocaleString('pt-BR')
    document.getElementById('tokens-saida').textContent = d.tokens.saida.toLocaleString('pt-BR')
    document.getElementById('custo-usd').textContent = `$${d.tokens.custo_usd}`
    if (d.tokens.saldo_usd !== null) {
      document.getElementById('saldo-usd').textContent = `$${d.tokens.saldo_usd}`
      document.getElementById('card-saldo').style.display = 'block'
    }
  }
}

// ── Usuários ──────────────────────────────────────

async function carregarUsuarios() {
  const r = await api('/usuarios')
  if (!r.ok) return
  const usuarios = await r.json()
  document.getElementById('tb-usuarios').innerHTML = usuarios.map(u => `
    <tr>
      <td>${u.nome || '<span style="color:#8C8880">—</span>'}</td>
      <td>📱 ${u.numero}</td>
      <td style="color:#8C8880;font-size:13px">${new Date(u.criado_em).toLocaleDateString('pt-BR')}</td>
      <td><button class="btn-danger" onclick="removerUsuario('${u.numero}', this)">Remover</button></td>
    </tr>
  `).join('')
}

async function adicionarUsuario() {
  const nome = document.getElementById('novo-nome').value.trim()
  const numero = document.getElementById('novo-numero').value.trim()
  mostrarErro('erro-usuarios', '')
  if (!numero) return mostrarErro('erro-usuarios', 'Informe o número')
  const r = await api('/usuarios', {
    method: 'POST',
    body: JSON.stringify({ nome, numero })
  })
  const data = await r.json()
  if (!r.ok) return mostrarErro('erro-usuarios', data.erro || 'Erro ao adicionar')
  document.getElementById('novo-nome').value = ''
  document.getElementById('novo-numero').value = ''
  carregarUsuarios()
}

async function removerUsuario(numero, btn) {
  if (!confirm(`Remover o usuário ${numero}?`)) return
  btn.disabled = true
  btn.textContent = '...'
  const r = await api(`/usuarios/${numero}`, { method: 'DELETE' })
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Remover'; return }
  carregarUsuarios()
}

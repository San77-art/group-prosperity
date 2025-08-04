const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// Middleware
app.use(session({
  secret: 'chave-secreta-super-segura-para-sessao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 60 * 1000 } // 30 min
}));

const axios = require('axios');

const ZAPI_TOKEN = 'SEU_TOKEN_AQUI'; // Substitua
const ZAPI_URL = 'https://api.z-api.io/instances/SEU_ID/messages/text';

// Função: enviar WhatsApp
async function enviarWhatsApp(numero, mensagem) {
  try {
    await axios.post(ZAPI_URL, {
      phone: numero,
      message: mensagem
    }, {
      headers: { 'Authorization': ZAPI_TOKEN }
    });
    console.log(`WhatsApp enviado para ${numero}`);
  } catch (err) {
    console.error('Erro ao enviar WhatsApp:', err.response?.data || err.message);
  }
}

// Rota: GET /admin.html → protegida
app.get('/admin.html', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.redirect('/index.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Rota: GET /api/admin/filas → retorna todas as filas
app.get('/api/admin/filas', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  const fila = lerFila();
  res.json(fila);
});

// Rota: GET /api/admin/exportar → exporta CSV
app.get('/api/admin/exportar', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user.usuario !== 'admin') {
    return res.status(403).json({ erro: 'Acesso negado' });
  }

  // Cabeçalho do CSV
  let csv = 'ID,Nome,Email,Celular,Nível,Cadastro\n';
  usuarios.forEach(u => {
    csv += `${u.usuario},"${u.nome} ${u.sobre}",${u.email},${u.celular},${u.nivel},${u.data_cadastro}\n`;
  });

  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', 'attachment; filename=usuarios.csv');
  res.send(csv);
});

// Serve a pasta public/ como estática
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 🔐 Middleware: verificar login
function verificaLogin(req, res, next) {
  if (req.session.usuario) {
    next();
  } else {
    res.redirect('/?erro=1');
  }
}

// 🔒 Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { erro: 'Muitas tentativas falhas. Tente novamente em 15 minutos.' }
});

const cadastroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { erro: 'Muitos cadastros. Tente novamente em 1 hora.' }
});

// Rota: GET / → login.html
app.get('/', (req, res) => {
  const params = new URLSearchParams(req.url.split('?')[1] || '');
  const erro = params.get('erro');
  const sucesso = params.get('sucesso');
  const cadastro = params.get('cadastro');

  fs.readFile(path.join(__dirname, 'public', 'login.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Erro ao carregar página.');

    let html = data;

    if (cadastro === 'ok') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-success">Cadastro realizado! Faça login abaixo.</div>');
    } else if (sucesso === '1') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-success">Login realizado com sucesso!</div>');
    } else if (erro === '1') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-danger">Usuário ou senha inválidos</div>');
    }

    res.send(html);
  });
});

// Outras rotas...
// Rota: POST /login
app.post('/login', loginLimiter, (req, res) => {
  const { usuario, senha } = req.body;
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === usuario);

  if (user && bcrypt.compareSync(senha, user.senha)) {
    req.session.usuario = user.usuario;
    req.session.nome = `${user.nome} ${user.sobre}`;
    return res.redirect('/index.html?sucesso=1');
  } else {
    return res.redirect('/?erro=1');
  }
});

// Rota: GET /index.html
app.get('/index.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota: GET /new-account.html
app.get('/new-account.html', cadastroLimiter, (req, res) => {
  fs.readFile(path.join(__dirname, 'public', 'new-account.html'), 'utf8', (err, data) => {
    if (err) return res.status(500).send('Erro ao carregar página.');

    let html = data;
    const params = new URLSearchParams(req.url.split('?')[1] || '');

    if (params.get('erro') === 'usuario-existe') {
      html = html.replace('<!-- MENSAGEM -->', '<div class="alert alert-danger">Usuário já cadastrado.</div>');
    } else if (params.get('erro') === 'senha') {
      const detalhe = decodeURIComponent(params.get('detalhe') || '');
      html = html.replace('<!-- MENSAGEM -->', `<div class="alert alert-warning">Senha fraca: ${detalhe}.</div>`);
    }

    res.send(html);
  });
});

// Rota: POST /cadastrar
app.post('/cadastrar', cadastroLimiter, async (req, res) => {
  const { nome, sobre, celular, email, patrocinador, usuario, senha, senha2 } = req.body;
  const usuarios = lerUsuarios();

  if (usuarios.some(u => u.usuario === usuario)) {
    return res.redirect('/new-account.html?erro=usuario-existe');
  }

  const erros = [];
  if (senha.length < 6) erros.push('mínimo 6 caracteres');
  if (!/\d/.test(senha)) erros.push('um número');
  if (!/[A-Z]/.test(senha)) erros.push('uma maiúscula');
  if (erros.length > 0) {
    return res.redirect(`/new-account.html?erro=senha&detalhe=${encodeURIComponent(erros.join(', '))}`);
  }

  if (senha !== senha2) {
    return res.redirect('/new-account.html?erro=senha&detalhe=senhas+não+coincidem');
  }

  const senhaHash = await bcrypt.hash(senha, 10);
  const avatar = `/man.jpeg`;

  const novoUsuario = { usuario, senha: senhaHash, nome, sobre, celular, email, patrocinador, avatar };
  usuarios.push(novoUsuario);
  salvarUsuarios(usuarios);

  res.redirect('/?cadastro=ok');
});

// Função: ler usuários
function lerUsuarios() {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'usuarios.json'), 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Erro ao ler usuarios.json:', err);
    return [];
  }
}

// Função: salvar usuários
function salvarUsuarios(usuarios) {
  fs.writeFileSync(path.join(__dirname, 'usuarios.json'), JSON.stringify(usuarios, null, 2));
}

// Rota: GET /profile-ch.html
app.get('/profile-ch.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile-ch.html'));
});

// Rota: GET /receipts.html
app.get('/receipts.html', verificaLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'receipts.html'));
});

// Rota: GET /api/usuario
app.get('/api/usuario', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  if (user) {
    res.json({
      nome: `${user.nome} ${user.sobre}`,
      email: user.email,
      celular: user.celular,
      avatar: user.avatar,
      patrocinador: user.patrocinador,
      usuario: user.usuario
    });
  } else {
    res.status(404).json({ erro: 'Usuário não encontrado' });
  }
});

// Rota: POST /api/perfil
app.post('/api/perfil', verificaLogin, (req, res) => {
  const { nome, sobre, celular } = req.body;
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);

  if (user) {
    user.nome = nome;
    user.sobre = sobre;
    user.celular = celular;
    salvarUsuarios(usuarios);
    res.json({ mensagem: 'Perfil atualizado!' });
  } else {
    res.status(404).json({ mensagem: 'Usuário não encontrado.' });
  }
});

// Rota: POST /api/avatar
app.post('/api/avatar', verificaLogin, (req, res) => {
  const { avatar } = req.body;
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);

  if (user && avatar && (avatar.startsWith('man') || avatar.startsWith('woman'))) {
    user.avatar = '/' + avatar;
    salvarUsuarios(usuarios);
    res.json({ mensagem: 'Avatar atualizado!' });
  } else {
    res.status(400).json({ mensagem: 'Avatar inválido.' });
  }
});

// Rota: POST /api/senha
app.post('/api/senha', verificaLogin, async (req, res) => {
  const { atual, nova } = req.body;
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);

  if (!user) return res.json({ mensagem: 'Erro: usuário não encontrado.' });

  if (!bcrypt.compareSync(atual, user.senha)) {
    return res.json({ mensagem: 'Senha atual incorreta.' });
  }

  if (nova.length < 6 || !/\d/.test(nova) || !/[A-Z]/.test(nova)) {
    return res.json({ mensagem: 'Nova senha fraca.' });
  }

  user.senha = await bcrypt.hash(nova, 10);
  salvarUsuarios(usuarios);

  res.json({ mensagem: 'Senha alterada com sucesso!' });
});

// Rota: GET /logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/?sucesso=logout');
  });
});

// Caminhos dos arquivos
const GIROS_FILE = path.join(__dirname, 'giros.json');
const FILA_FILE = path.join(__dirname, 'fila.json');

// Função: ler giros
function lerGiros() {
  try {
    return JSON.parse(fs.readFileSync(GIROS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

// Função: ler fila
function lerFila() {
  try {
    return JSON.parse(fs.readFileSync(FILA_FILE, 'utf-8'));
  } catch (err) {
    return { "2": [], "3": [], "4": [], "5": [] };
  }
}

// Função: salvar fila
function salvarFila(fila) {
  fs.writeFileSync(FILA_FILE, JSON.stringify(fila, null, 2));
}

// Rota: GET /giros → retorna os níveis
app.get('/api/giros', verificaLogin, (req, res) => {
  const giros = lerGiros();
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  const fila = lerFila();

  res.json({
    giros,
    nivelAtual: user?.nivel || 1,
    posicaoNaFila: user ? fila[user.nivel]?.findIndex(u => u.usuario === user.usuario) + 1 : null
  });
});

// Rota: POST /entrar-na-fila
app.post('/api/entrar-na-fila', verificaLogin, (req, res) => {
  const usuarios = lerUsuarios();
  const user = usuarios.find(u => u.usuario === req.session.usuario);
  const fila = lerFila();
  const giros = lerGiros();

  if (!user) return res.json({ erro: 'Usuário não encontrado' });

  const nivel = user.nivel;
  const giro = giros.find(g => g.nivel === nivel);

  if (!giro || nivel === 1) {
    return res.json({ erro: 'Nível inválido para fila' });
  }

  // Verifica se já está na fila
  if (fila[nivel] && fila[nivel].some(u => u.usuario === user.usuario)) {
    return res.json({ erro: 'Você já está na fila deste nível' });
  }

  // Adiciona na fila
  if (!fila[nivel]) fila[nivel] = [];
  fila[nivel].push({ usuario: user.usuario, data: new Date().toISOString().split('T')[0] });
  salvarFila(fila);

  res.json({ mensagem: `Você entrou na fila do Giro ${nivel}!` });
});

// Rota: POST /processar-fila
app.post('/api/processar-fila', verificaLogin, (req, res) => {
  const { nivel } = req.body;
  const usuarios = lerUsuarios();
  const fila = lerFila();
  const giros = lerGiros();
  const admin = usuarios.find(u => u.usuario === req.session.usuario);

  // Só admin pode processar (ou você pode automatizar)
  if (admin.usuario !== 'admin') {
    return res.json({ erro: 'Acesso negado' });
  }

  const filaNivel = fila[nivel];
  if (!filaNivel || filaNivel.length === 0) {
    return res.json({ erro: 'Fila vazia' });
  }

  const primeiro = filaNivel.shift();
  const user = usuarios.find(u => u.usuario === primeiro.usuario);

  if (user) {
    user.nivel += 1; // Próximo nível
    user.ultimo_giro = new Date().toISOString().split('T')[0];
  }

  salvarFila(fila);
  salvarUsuarios(usuarios);

  res.json({ mensagem: `Usuário ${primeiro.usuario} avançou para o próximo nível!` });
});

// Função: processar fila automaticamente
function processarFilaAutomaticamente() {
  const fila = lerFila();
  const usuarios = lerUsuarios();
  const giros = lerGiros();

  for (let nivel = 2; nivel <= 5; nivel++) {
    const filaNivel = fila[nivel];
    if (filaNivel && filaNivel.length > 0) {
      const primeiro = filaNivel.shift();
      const user = usuarios.find(u => u.usuario === primeiro.usuario);

      if (user) {
        const giroAtual = giros.find(g => g.nivel === user.nivel);
        if (giroAtual) {
          user.nivel += 1;
          user.ultimo_giro = new Date().toISOString().split('T')[0];
          console.log(`✅ Usuário ${user.usuario} avançou para o Giro ${user.nivel}`);
        }
      }
    }
  }

  salvarFila(fila);
  salvarUsuarios(usuarios);
}

// Executar a cada 5 minutos (300000 ms)
setInterval(processarFilaAutomaticamente, 300000); // 5 minutos

// Executar agora na inicialização
processarFilaAutomaticamente();

// Inicia servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
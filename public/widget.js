/**
 * Nexus Web Chat Widget
 * Widget de chat flutuante e auto-contido para sites externos.
 */
(function () {
  if (window.__NEXUS_WIDGET_LOADED__) return;
  window.__NEXUS_WIDGET_LOADED__ = true;

  // Encontra a tag script atual e seus atributos
  var currentScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();

  var orgIdOrSlug = currentScript.getAttribute("data-org") || "";
  var agentId = currentScript.getAttribute("data-agent") || "";
  var primaryColor = currentScript.getAttribute("data-color") || "#2563eb";
  var chatTitle = currentScript.getAttribute("data-title") || "Atendimento Inteligente";
  var welcomeMessage =
    currentScript.getAttribute("data-welcome") ||
    "Olá! Como posso ajudar você hoje? Fique à vontade para tirar dúvidas sobre nossos produtos, serviços ou agendamentos.";
  var whatsappNumber = currentScript.getAttribute("data-whatsapp") || "";
  var position = currentScript.getAttribute("data-position") || "right"; // 'right' or 'left'

  // Servidor da API (usa a origem do próprio script)
  var scriptSrc = currentScript.src || "";
  var apiBaseUrl = "";
  try {
    var parsedUrl = new URL(scriptSrc);
    apiBaseUrl = parsedUrl.origin;
  } catch (e) {
    apiBaseUrl = window.location.origin;
  }

  // Gera ou recupera o sessionId no localStorage
  var storageKey = "nexus_chat_session_" + (orgIdOrSlug || "default");
  var sessionId = localStorage.getItem(storageKey);
  if (!sessionId) {
    sessionId = "nx_" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    try {
      localStorage.setItem(storageKey, sessionId);
    } catch (e) {}
  }

  // Injeta estilos CSS
  var style = document.createElement("style");
  style.textContent = `
    .nx-chat-launcher {
      position: fixed;
      bottom: 24px;
      ${position === "left" ? "left: 24px;" : "right: 24px;"}
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background-color: ${primaryColor};
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: none;
      outline: none;
    }
    .nx-chat-launcher:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
    }
    .nx-chat-launcher svg {
      width: 28px;
      height: 28px;
      fill: #ffffff;
    }
    .nx-chat-window {
      position: fixed;
      bottom: 96px;
      ${position === "left" ? "left: 24px;" : "right: 24px;"}
      width: 380px;
      max-width: calc(100vw - 48px);
      height: 560px;
      max-height: calc(100vh - 120px);
      background-color: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      display: none;
      flex-direction: column;
      overflow: hidden;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      animation: nxFadeIn 0.25s ease-out;
    }
    @keyframes nxFadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .nx-chat-header {
      background-color: ${primaryColor};
      color: #ffffff;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nx-chat-header-title {
      font-size: 15px;
      font-weight: 600;
      margin: 0;
      line-height: 1.2;
    }
    .nx-chat-header-subtitle {
      font-size: 12px;
      opacity: 0.85;
      margin: 3px 0 0 0;
    }
    .nx-chat-close-btn {
      background: transparent;
      border: none;
      color: #ffffff;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      padding: 4px;
      opacity: 0.8;
    }
    .nx-chat-close-btn:hover { opacity: 1; }
    .nx-chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      background-color: #f9fafb;
    }
    .nx-msg {
      max-width: 82%;
      padding: 10px 14px;
      border-radius: 14px;
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }
    .nx-msg-agent {
      align-self: flex-start;
      background-color: #ffffff;
      color: #1f2937;
      border: 1px solid #e5e7eb;
      border-bottom-left-radius: 3px;
    }
    .nx-msg-user {
      align-self: flex-end;
      background-color: ${primaryColor};
      color: #ffffff;
      border-bottom-right-radius: 3px;
    }
    .nx-chat-input-area {
      padding: 12px;
      background-color: #ffffff;
      border-top: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .nx-chat-input {
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 20px;
      padding: 10px 14px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    .nx-chat-input:focus {
      border-color: ${primaryColor};
    }
    .nx-chat-send-btn {
      background-color: ${primaryColor};
      color: #ffffff;
      border: none;
      border-radius: 50%;
      width: 38px;
      height: 38px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s;
      flex-shrink: 0;
    }
    .nx-chat-send-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .nx-chat-whatsapp-banner {
      background-color: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      padding: 8px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: #166534;
    }
    .nx-chat-whatsapp-link {
      color: #15803d;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
    .nx-typing-indicator {
      display: flex;
      gap: 4px;
      padding: 4px 8px;
    }
    .nx-typing-dot {
      width: 6px;
      height: 6px;
      background-color: #9ca3af;
      border-radius: 50%;
      animation: nxBounce 1.4s infinite ease-in-out both;
    }
    .nx-typing-dot:nth-child(1) { animation-delay: -0.32s; }
    .nx-typing-dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes nxBounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
  `;
  document.head.appendChild(style);

  // Renderiza a estrutura do DOM
  var launcher = document.createElement("button");
  launcher.className = "nx-chat-launcher";
  launcher.setAttribute("aria-label", "Abrir chat");
  launcher.innerHTML = `
    <svg viewBox="0 0 24 24">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
    </svg>
  `;

  var windowEl = document.createElement("div");
  windowEl.className = "nx-chat-window";

  var whatsappBannerHtml = "";
  if (whatsappNumber) {
    var waClean = whatsappNumber.replace(/\D/g, "");
    whatsappBannerHtml = `
      <div class="nx-chat-whatsapp-banner">
        <span>Prefere atendimento no WhatsApp?</span>
        <a class="nx-chat-whatsapp-link" href="https://wa.me/${waClean}?text=Ol%C3%A1%2C+gostaria+de+atendimento" target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>
      </div>
    `;
  }

  windowEl.innerHTML = `
    <div class="nx-chat-header">
      <div>
        <h3 class="nx-chat-header-title">${chatTitle}</h3>
        <p class="nx-chat-header-subtitle">Online agora</p>
      </div>
      <button class="nx-chat-close-btn" aria-label="Fechar chat">&times;</button>
    </div>
    ${whatsappBannerHtml}
    <div class="nx-chat-messages" id="nx-messages-container"></div>
    <div class="nx-chat-input-area">
      <input type="text" class="nx-chat-input" placeholder="Digite sua mensagem..." id="nx-input-field" />
      <button class="nx-chat-send-btn" id="nx-send-btn" aria-label="Enviar mensagem">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
        </svg>
      </button>
    </div>
  `;

  document.body.appendChild(launcher);
  document.body.appendChild(windowEl);

  var isOpen = false;
  var messagesContainer = windowEl.querySelector("#nx-messages-container");
  var inputField = windowEl.querySelector("#nx-input-field");
  var sendBtn = windowEl.querySelector("#nx-send-btn");
  var closeBtn = windowEl.querySelector(".nx-chat-close-btn");

  var chatHistory = [];

  function formatMessageText(text) {
    // Escape HTML
    var escaped = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    // Formatação leve de markdown
    escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*(.*?)\*/g, "<em>$1</em>");
    escaped = escaped.replace(/\n/g, "<br>");
    return escaped;
  }

  function appendMessage(role, text) {
    var msgEl = document.createElement("div");
    msgEl.className = "nx-msg " + (role === "user" ? "nx-msg-user" : "nx-msg-agent");
    msgEl.innerHTML = formatMessageText(text);
    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function showTypingIndicator() {
    var typingEl = document.createElement("div");
    typingEl.id = "nx-typing";
    typingEl.className = "nx-msg nx-msg-agent nx-typing-indicator";
    typingEl.innerHTML = `
      <div class="nx-typing-dot"></div>
      <div class="nx-typing-dot"></div>
      <div class="nx-typing-dot"></div>
    `;
    messagesContainer.appendChild(typingEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function hideTypingIndicator() {
    var typingEl = document.getElementById("nx-typing");
    if (typingEl) typingEl.remove();
  }

  // Adiciona mensagem de boas-vindas inicial
  appendMessage("agent", welcomeMessage);

  function toggleChat() {
    isOpen = !isOpen;
    windowEl.style.display = isOpen ? "flex" : "none";
    if (isOpen) {
      inputField.focus();
    }
  }

  launcher.addEventListener("click", toggleChat);
  closeBtn.addEventListener("click", toggleChat);

  async function handleSend() {
    var text = inputField.value.trim();
    if (!text) return;

    inputField.value = "";
    sendBtn.disabled = true;
    appendMessage("user", text);
    chatHistory.push({ role: "user", content: text });

    showTypingIndicator();

    try {
      var res = await fetch(apiBaseUrl + "/api/v1/public/widget/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          org: orgIdOrSlug,
          agent_id: agentId || undefined,
          session_id: sessionId,
          message: text,
          history: chatHistory.slice(-8), // últimas 8 mensagens para manter o contexto
        }),
      });

      var data = await res.json();
      hideTypingIndicator();

      if (res.ok && data && (data.reply || data.data?.reply)) {
        var reply = data.reply || data.data.reply;
        appendMessage("agent", reply);
        chatHistory.push({ role: "assistant", content: reply });
      } else {
        var erroMsg = data?.error?.message || "Desculpe, ocorreu um problema momentâneo. Pode tentar novamente em instantes?";
        appendMessage("agent", erroMsg);
      }
    } catch (e) {
      hideTypingIndicator();
      appendMessage("agent", "Não consegui me conectar ao servidor no momento. Por favor, tente novamente.");
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener("click", handleSend);
  inputField.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });
})();


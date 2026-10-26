/**
 * [قرار المستخدم] الرسائل بين المريض والصيدلية.
 *
 * محادثتان من نوعين (order-service، conversations.py):
 * - عامة: واحدة لكل مريض وصيدلية، يبدؤها المريض من صفحة الصيدلية («راسل الصيدلية»).
 * - محادثة طلب: واحدة لكل طلب، في صفحة الطلب عند الطرفين (mountOrderChat).
 *
 * mountChat()          محادثة واحدة: الرسائل، «رسائل أقدم»، وحقل الكتابة. تتحدث كل 5 ثوانٍ.
 * mountMessagesPage()  صفحة «الرسائل»: قائمة المحادثات وبجانبها المحادثة المفتوحة (?c=<المعرف>).
 *
 * فتح محادثة يعلّم رسائلها مقروءة، ويُرسل medplat:messages فيتحدث العدد في القائمة الجانبية.
 */

import { conversations, notifications } from "./api.js";
import { $, $$, cx, html, render } from "./dom.js";
import { formatDateTime, relativeTime } from "./format.js";
import { icon } from "./icons.js";
import { errorMessage } from "./text.js";
import { button, emptyState, errorState, loading, toast } from "./ui.js";

const POLL_MS = 5_000;
const LIST_POLL_MS = 15_000;

const otherSide = (conversation, role) => (role === "PATIENT" ? conversation.pharmacy.name : conversation.patient.name);
const orderLink = (conversation, role) => `/${role === "PATIENT" ? "patient" : "pharmacy"}/orders/${conversation.order.id}`;
const notifyCount = () => window.dispatchEvent(new Event("medplat:messages"));

/** إشعار «رسالة من …» لمحادثة قُرئت للتو: يُعلَّم مقروءًا أيضًا، فلا يبقى الجرس ينبّه لما رآه. */
async function clearNotifications(conversationId) {
  try {
    const { items } = await notifications.list({ unread: true, limit: 50 });
    const related = items.filter((n) => n.entity_type === "CONVERSATION" && n.entity_id === conversationId);
    await Promise.all(related.map((n) => notifications.markRead(n.id)));
    if (related.length) window.dispatchEvent(new Event("medplat:notifications"));
  } catch {
    /* ليس مهمًا: يبقى الإشعار غير مقروء */
  }
}

const bubble = (m) => html`<div class="${cx("bubble", m.mine && "bubble--mine")}" data-message="${m.id}">
  <div class="bubble__text" dir="auto">${m.body}</div>
  <span class="bubble__time">${formatDateTime(m.created_at)}</span>
</div>`;

/**
 * محادثة واحدة داخل container. conversation: كما يرجعها الخادم. variant: "card" (في صفحة الطلب)
 * أو "page" (صفحة الرسائل). onBack: زر الرجوع للقائمة (الجوال). onActivity: بعد إرسال أو قراءة.
 * يرجع { stop } لإيقاف التحديث الدوري.
 */
export function mountChat(container, { conversation, role, variant = "card", onBack, onActivity }) {
  const id = conversation.id;
  let messages = [];
  let hasMore = false;
  let stopped = false;
  let polling = false;

  render(
    container,
    html`<div class="${cx("chat", `chat--${variant}`)}">
      <div class="chat__head">
        ${onBack ? html`<button type="button" class="chat__back" data-action="back" aria-label="المحادثات">${icon("chevron_right", 20)}</button>` : ""}
        <span class="tile">${icon(role === "PATIENT" ? "store" : "user_round", 20)}</span>
        <div class="grow">
          <div class="semi"><bdi>${otherSide(conversation, role)}</bdi></div>
          <div class="tiny muted">${conversation.order
            ? html`عن <a href="${orderLink(conversation, role)}">${conversation.order.kind === "PRESCRIPTION" ? "وصفة" : "طلب"} ${formatDateTime(conversation.order.created_at)}</a>`
            : role === "PATIENT" ? "محادثة مع الصيدلية" : "محادثة مع المريض"}</div>
        </div>
      </div>
      <div class="chat__messages" data-slot="messages">${loading()}</div>
      <form class="chat__compose" data-slot="compose">
        <textarea class="input" name="body" rows="1" maxlength="1000" dir="auto" placeholder="اكتب رسالة…" aria-label="رسالتك"></textarea>
        <button type="submit" class="btn btn--primary chat__send" aria-label="إرسال">${icon("send", 18)}<span>إرسال</span></button>
      </form>
    </div>`,
  );
  const root = container.firstElementChild;
  const list = $("[data-slot=messages]", root);
  const form = $("[data-slot=compose]", root);
  const input = $("[name=body]", form);
  const sendButton = $("button[type=submit]", form);
  $("[data-action=back]", root)?.addEventListener("click", onBack);

  const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 80;

  function draw({ toBottom = false, keepFrom = null } = {}) {
    const stick = toBottom || nearBottom();
    const before = list.scrollHeight;
    render(
      list,
      messages.length === 0
        ? html`<p class="chat__empty small muted">لا رسائل بعد. اكتب أول رسالة.</p>`
        : html`${hasMore ? html`<div class="chat__older">${button("رسائل أقدم", { size: "sm", variant: "quiet", action: "older" })}</div>` : ""}${messages.map(bubble)}`,
    );
    $("[data-action=older]", list)?.addEventListener("click", older);
    if (keepFrom !== null) list.scrollTop = list.scrollHeight - before + keepFrom;
    else if (stick) list.scrollTop = list.scrollHeight;
  }

  async function markRead() {
    try {
      await conversations.markRead(id);
    } catch {
      return;
    }
    notifyCount();
    clearNotifications(id);
    onActivity?.();
  }

  async function first() {
    let data;
    try {
      data = await conversations.thread(id);
    } catch (error) {
      render(list, errorState(error));
      return;
    }
    messages = data.messages;
    hasMore = data.has_more;
    draw({ toBottom: true });
    if (data.conversation.unread) markRead();
  }

  async function older() {
    const from = list.scrollTop;
    try {
      const data = await conversations.thread(id, { before: messages[0].id });
      messages = [...data.messages, ...messages];
      hasMore = data.has_more;
    } catch (error) {
      toast.error(error);
      return;
    }
    draw({ keepFrom: from });
  }

  async function poll() {
    if (stopped || polling || document.visibilityState !== "visible" || !document.contains(root)) return;
    polling = true;
    try {
      const last = messages.at(-1);
      const data = await conversations.thread(id, last ? { after: last.id } : undefined);
      const known = new Set(messages.map((m) => m.id));
      const fresh = data.messages.filter((m) => !known.has(m.id));
      if (fresh.length) {
        messages = [...messages, ...fresh];
        draw();
        if (fresh.some((m) => !m.mine)) markRead();
      }
    } catch {
      /* انقطاع مؤقت: المحاولة التالية بعد قليل */
    } finally {
      polling = false;
    }
  }

  async function send() {
    const body = input.value.trim();
    if (!body) return;
    sendButton.disabled = true;
    try {
      const message = await conversations.send(id, body);
      if (!messages.some((m) => m.id === message.id)) messages = [...messages, message];
      input.value = "";
      input.style.height = "";
      draw({ toBottom: true });
      onActivity?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    send();
  });
  // Enter يرسل، و Shift+Enter سطر جديد. الحقل يكبر مع النص حتى حد.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      send();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  });

  first();
  const timer = setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", poll);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    },
  };
}

/** محادثة الطلب في صفحة الطلب (للمريض صاحبه وللصيدلية المرسل إليها). */
export async function mountOrderChat(container, { orderId, role }) {
  render(
    container,
    html`<section class="section">
      <div class="section__head"><h2>${role === "PATIENT" ? "راسل الصيدلية عن هذا الطلب" : "راسل المريض عن هذا الطلب"}</h2></div>
      <div class="card" data-slot="chat">${loading()}</div>
    </section>`,
  );
  const box = $("[data-slot=chat]", container);
  let conversation;
  try {
    conversation = await conversations.forOrder(orderId);
  } catch (error) {
    render(box, html`<div class="card__body">${errorState(error)}</div>`);
    return null;
  }
  return mountChat(box, { conversation, role, variant: "card" });
}

// ----------------------------------------------------------------------------- صفحة «الرسائل»

/** صفحة «الرسائل» للمريض أو الصيدلية داخل root. */
export function mountMessagesPage(root, { role }) {
  let items = [];
  let selected = new URLSearchParams(location.search).get("c");
  let chat = null;
  let ask = 0;

  render(
    root,
    html`<div class="chat-layout">
      <section class="chat-layout__list"><div class="card" data-slot="list">${loading()}</div></section>
      <section class="chat-layout__thread" data-slot="thread"></section>
    </div>`,
  );
  const layout = root.firstElementChild;
  const listBox = $("[data-slot=list]", root);
  const threadBox = $("[data-slot=thread]", root);

  const preview = (c) => (c.last_message ? `${c.last_message.mine ? "أنت: " : ""}${c.last_message.body}` : "");

  function drawList() {
    if (items.length === 0) {
      render(
        listBox,
        emptyState({
          icon: "messages_square",
          title: "لا رسائل بعد",
          hint:
            role === "PATIENT"
              ? "راسل أي صيدلية من صفحتها في «الصيدليات»، أو من صفحة طلبك."
              : "تصلك هنا رسائل المرضى. وتستطيع مراسلة المريض من صفحة طلبه.",
          action: role === "PATIENT" ? button("الصيدليات", { variant: "soft", href: "/patient/pharmacies" }) : "",
        }),
      );
      return;
    }
    render(
      listBox,
      html`<div class="rows chat-list">${items.map(
        (c) => html`<button type="button" class="${cx("row chat-item", c.id === selected && "is-active", c.unread && "is-unread")}" data-open="${c.id}">
          <span class="tile">${icon(role === "PATIENT" ? "store" : "user_round", 20)}</span>
          <span class="chat-item__main">
            <span class="chat-item__top">
              <span class="semi chat-item__name"><bdi>${otherSide(c, role)}</bdi></span>
              <span class="tiny muted nowrap">${relativeTime(c.last_message_at)}</span>
            </span>
            ${c.order ? html`<span class="tiny" style="color: var(--violet-700)">عن ${c.order.kind === "PRESCRIPTION" ? "وصفة" : "طلب"}</span>` : ""}
            <span class="chat-item__preview small soft" dir="auto">${preview(c)}</span>
          </span>
          ${c.unread ? html`<span class="nav__count">${c.unread}</span>` : ""}
        </button>`,
      )}</div>`,
    );
    $$("[data-open]", listBox).forEach((el) => el.addEventListener("click", () => open(el.dataset.open)));
  }

  function drawPlaceholder() {
    render(threadBox, html`<div class="card chat-layout__placeholder">${emptyState({ icon: "message_circle", title: "اختر محادثة", hint: `رسائلك مع ${role === "PATIENT" ? "الصيدليات" : "المرضى"} هنا.` })}</div>`);
  }

  async function loadList() {
    const mine = ++ask;
    let result;
    try {
      result = await conversations.list({ limit: 50 });
    } catch (error) {
      if (mine === ask && items.length === 0) render(listBox, errorState(error));
      return;
    }
    if (mine !== ask) return;
    items = result.items;
    drawList();
  }

  function back() {
    chat?.stop();
    chat = null;
    selected = null;
    history.replaceState(null, "", location.pathname);
    layout.classList.remove("has-thread");
    drawList();
    drawPlaceholder();
  }

  async function open(id) {
    chat?.stop();
    selected = id;
    history.replaceState(null, "", `${location.pathname}?c=${id}`);
    layout.classList.add("has-thread");
    drawList();
    let conversation = items.find((c) => c.id === id);
    if (!conversation) {
      // محادثة جديدة بلا رسائل بعد (فُتحت من صفحة صيدلية): ليست في القائمة.
      render(threadBox, html`<div class="card">${loading()}</div>`);
      try {
        conversation = (await conversations.thread(id)).conversation;
      } catch (error) {
        render(threadBox, html`<div class="card"><div class="card__body">${errorState(error)}</div></div>`);
        return;
      }
    }
    render(threadBox, html`<div class="card chat-card"></div>`);
    chat = mountChat(threadBox.firstElementChild, { conversation, role, variant: "page", onBack: back, onActivity: loadList });
  }

  loadList().then(() => (selected ? open(selected) : drawPlaceholder()));
  setInterval(() => document.visibilityState === "visible" && loadList(), LIST_POLL_MS);
}

/** المريض يراسل صيدلية: يفتح المحادثة العامة بينهما في صفحة «الرسائل». */
export async function messagePharmacy(pharmacyId, buttonElement) {
  if (buttonElement) buttonElement.disabled = true;
  try {
    const conversation = await conversations.withPharmacy(pharmacyId);
    location.href = `/patient/messages?c=${conversation.id}`;
  } catch (error) {
    if (buttonElement) buttonElement.disabled = false;
    toast.error(error);
  }
}

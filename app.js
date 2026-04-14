const DEFAULT_SHEETS_CONFIG = {
  appsScriptUrl: "",
  spreadsheetId: "1OuVbUpXMj8C47ZcZNGQBChixuB0X0Ic7xS6CnPhp-2c",
  spreadsheetName: "Sebli Restaurant Admin"
}

const ADMIN_SESSION_KEY = "sebliAdminPassword"
const MAX_MENU_IMAGE_BYTES = 10 * 1024 * 1024
const LEGACY_INLINE_IMAGE_LIMIT = 45000

function getSheetsConfig() {
  return {
    ...DEFAULT_SHEETS_CONFIG,
    ...(window.SEBLI_SHEETS_CONFIG || {})
  }
}

function getAppsScriptUrl() {
  return String(getSheetsConfig().appsScriptUrl || "").trim()
}

function ensureSheetsConfigured() {
  if (getAppsScriptUrl()) {
    return
  }

  throw new Error("Google Sheets is not configured yet. Add your deployed Apps Script /exec URL to `sheets-config.js`.")
}

async function requestSheets(action, payload = {}, options = {}) {
  ensureSheetsConfigured()

  const body = {
    action,
    ...payload
  }

  if (options.admin) {
    const adminPassword = getStoredAdminPassword()

    if (!adminPassword) {
      throw new Error("Enter the admin password to access the dashboard.")
    }

    body.adminPassword = adminPassword
  }

  if (options.adminPassword) {
    body.adminPassword = String(options.adminPassword || "").trim()
  }

  let response

  try {
    response = await fetch(getAppsScriptUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(body)
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("Cannot reach the Google Sheets bridge. Check the Apps Script deployment URL in `sheets-config.js`.")
    }

    throw error
  }

  const responseText = await response.text()
  let data = {}

  try {
    data = responseText ? JSON.parse(responseText) : {}
  } catch (error) {
    throw new Error("Received an unreadable response from Google Sheets.")
  }

  if (!response.ok || data.ok === false || data.error) {
    throw new Error(data.error || "Google Sheets request failed.")
  }

  return data.data || {}
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function serializeForm(formElement) {
  const formData = new FormData(formElement)
  return Object.fromEntries(formData.entries())
}

function getSubmitControl(formElement, event) {
  const submitter = event?.submitter

  if (submitter instanceof HTMLElement) {
    return submitter
  }

  return formElement.querySelector('button[type="submit"], button:not([type]), input[type="submit"]')
}

function setLoadingState(control, isLoading, loadingText = "Submitting...") {
  if (!control) {
    return
  }

  if (isLoading) {
    control.dataset.previousDisabled = control.disabled ? "true" : "false"
    control.disabled = true
    control.setAttribute("aria-busy", "true")
    control.classList.add("cursor-not-allowed", "opacity-80")

    if (control instanceof HTMLInputElement) {
      control.dataset.originalValue = control.value
      control.value = loadingText
      return
    }

    control.dataset.originalHtml = control.innerHTML
    control.innerHTML = `
      <span class="inline-flex items-center justify-center gap-2">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
        <span>${escapeText(loadingText)}</span>
      </span>
    `
    return
  }

  control.disabled = control.dataset.previousDisabled === "true"
  control.removeAttribute("aria-busy")
  control.classList.remove("cursor-not-allowed", "opacity-80")

  if (control instanceof HTMLInputElement) {
    control.value = control.dataset.originalValue || control.value
    delete control.dataset.originalValue
  } else if (typeof control.dataset.originalHtml === "string") {
    control.innerHTML = control.dataset.originalHtml
    delete control.dataset.originalHtml
  }

  delete control.dataset.previousDisabled
}

function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve)
    })
  })
}

async function withControlLoading(control, loadingText, callback) {
  setLoadingState(control, true, loadingText)

  try {
    await waitForNextPaint()
    return await callback()
  } finally {
    setLoadingState(control, false)
  }
}

async function withLoadingState(formElement, event, loadingText, callback) {
  const submitControl = getSubmitControl(formElement, event)
  return withControlLoading(submitControl, loadingText, callback)
}

function isUnsupportedActionError(error, actionName) {
  return new RegExp(`Unsupported action:\\s*${actionName}`, "i").test(String(error?.message || ""))
}

function normalizeImageSource(imageUrl) {
  if (!imageUrl) {
    return "album-1.jpg"
  }

  if (/^(https?:)?\/\//i.test(imageUrl) || /^data:image\//i.test(imageUrl)) {
    return imageUrl
  }

  return imageUrl.replace(/^\.?\//, "")
}

function groupItemsByCategory(items) {
  return items.reduce((groups, item) => {
    const category = String(item.category || "Featured").trim() || "Featured"

    if (!groups[category]) {
      groups[category] = []
    }

    groups[category].push(item)
    return groups
  }, {})
}

function getStoredAdminPassword() {
  return sessionStorage.getItem(ADMIN_SESSION_KEY) || ""
}

function clearAdminAccess() {
  sessionStorage.removeItem(ADMIN_SESSION_KEY)
}

function hasAdminAccess() {
  return Boolean(getStoredAdminPassword().trim())
}

async function saveAdminAccess(password) {
  const normalizedPassword = String(password || "").trim()

  if (!normalizedPassword) {
    throw new Error("Enter the admin password.")
  }

  await requestSheets("verifyAdmin", {}, { adminPassword: normalizedPassword })
  sessionStorage.setItem(ADMIN_SESSION_KEY, normalizedPassword)
}

async function verifyAdminAccess() {
  await requestSheets("verifyAdmin", {}, { admin: true })
}

function renderOrderSummary(container, order) {
  if (!container) {
    return
  }

  const statusClasses = {
    pending: "bg-amber-500/10 text-amber-600",
    "on the way": "bg-blue-500/10 text-blue-600",
    delivered: "bg-emerald-500/10 text-emerald-600"
  }

  const statusKey = String(order.status || "pending").toLowerCase()
  const statusClass = statusClasses[statusKey] || statusClasses.pending

  container.innerHTML = `
    <div class="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p class="text-sm text-stone-500 dark:text-stone-400">Order ID</p>
          <p class="text-lg font-bold text-stone-900 dark:text-white">${escapeHtml(order.id)}</p>
        </div>
        <span class="inline-flex w-fit rounded-full px-3 py-1 text-sm font-semibold ${statusClass}">
          ${escapeHtml(order.status || "pending")}
        </span>
      </div>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p class="text-sm text-stone-500 dark:text-stone-400">Customer</p>
          <p class="font-medium text-stone-900 dark:text-white">${escapeHtml(order.customerName)}</p>
        </div>
        <div>
          <p class="text-sm text-stone-500 dark:text-stone-400">Item</p>
          <p class="font-medium text-stone-900 dark:text-white">${escapeHtml(order.itemName)}</p>
        </div>
        <div>
          <p class="text-sm text-stone-500 dark:text-stone-400">Quantity</p>
          <p class="font-medium text-stone-900 dark:text-white">${escapeHtml(order.quantity)}</p>
        </div>
        <div>
          <p class="text-sm text-stone-500 dark:text-stone-400">Total</p>
          <p class="font-medium text-primary">$${escapeHtml(order.total)}</p>
        </div>
      </div>
    </div>
  `
}

function normalizeBookingPayload(payload, serviceType) {
  return {
    serviceType,
    firstName: payload.firstName || payload["first-name"] || "",
    lastName: payload.lastName || payload["last-name"] || "",
    phone: payload.phone || payload.phoneNumber || payload["phone-number"] || "",
    email: payload.email || "",
    guests: payload.guests || "",
    date: payload.date || "",
    time: payload.time || "",
    startTime: payload.startTime || payload["start-time"] || "",
    endTime: payload.endTime || payload["end-time"] || "",
    eventType: payload.eventType || payload["event-type"] || "",
    budget: payload.budget || "",
    venueAddress: payload.venueAddress || payload["venue-address"] || "",
    cateringPackage: payload.cateringPackage || payload["catering-package"] || "",
    hookahFlavors: payload.hookahFlavors || payload["hookah-flavors"] || "",
    dietaryRestrictions: payload.dietaryRestrictions || payload["dietary-restrictions"] || "",
    details: payload.details || payload["special-requests"] || payload.specialRequests || ""
  }
}

async function attachBookingForms() {
  const bookingForms = document.querySelectorAll("[data-booking-form]")

  bookingForms.forEach((formElement) => {
    formElement.addEventListener("submit", async (event) => {
      event.preventDefault()

      await withLoadingState(formElement, event, "Booking...", async () => {
        try {
          const payload = normalizeBookingPayload(serializeForm(formElement), formElement.dataset.bookingForm || "general")
          const data = await requestSheets("createBooking", payload)
          alert(`Booked successfully. Booking ID: ${data.booking.id}`)
          formElement.reset()
        } catch (error) {
          alert(error.message)
        }
      })
    })
  })
}

async function attachNewsletterForms() {
  const newsletterForms = document.querySelectorAll("[data-newsletter-form]")

  newsletterForms.forEach((formElement) => {
    formElement.addEventListener("submit", async (event) => {
      event.preventDefault()

      await withLoadingState(formElement, event, "Submitting...", async () => {
        try {
          const payload = serializeForm(formElement)
          const result = await requestSheets("subscribeNewsletter", { email: payload.email || "" })
          alert(result.duplicate ? "This email is already subscribed." : "You have successfully joined the newsletter.")
          formElement.reset()
        } catch (error) {
          alert(error.message)
        }
      })
    })
  })
}

async function loadDynamicMenu() {
  const menuContainer = document.getElementById("dynamicMenuGrid")
  const orderSelect = document.getElementById("orderItem")

  if (!menuContainer && !orderSelect) {
    return
  }

  try {
    const data = await requestSheets("getPublicItems")
    const items = data.items || []

    if (menuContainer) {
      if (!items.length) {
        menuContainer.innerHTML = `
          <div class="rounded-3xl border border-dashed border-stone-300 bg-white/70 p-10 text-center text-stone-500 shadow-sm dark:border-stone-700 dark:bg-stone-900/70 dark:text-stone-400">
            No menu items have been added yet.
          </div>
        `
      } else {
        const groupedItems = groupItemsByCategory(items)

        menuContainer.innerHTML = Object.entries(groupedItems)
          .map(([category, categoryItems]) => `
            <section class="space-y-6">
              <div class="flex flex-col gap-2 border-b border-stone-200 pb-4 dark:border-stone-800">
                <p class="text-xs font-semibold uppercase tracking-[0.3em] text-primary">Menu Category</p>
                <h3 class="text-2xl font-extrabold text-stone-900 dark:text-white">${escapeHtml(category)}</h3>
              </div>
              <div class="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
                ${categoryItems.map((item) => `
                  <article class="group overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-xl dark:border-stone-800 dark:bg-stone-900">
                    <div class="aspect-[4/3] overflow-hidden bg-stone-100 dark:bg-stone-950">
                      <img
                        src="${escapeHtml(normalizeImageSource(item.imageUrl))}"
                        alt="${escapeHtml(item.name)}"
                        class="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                        onerror="this.src='menu-2.jpg'"
                      />
                    </div>
                    <div class="space-y-4 p-6">
                      <div class="flex items-start justify-between gap-4">
                        <div class="space-y-2">
                          <span class="inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-primary">
                            ${escapeHtml(category)}
                          </span>
                          <h4 class="text-xl font-bold text-stone-900 dark:text-white">${escapeHtml(item.name)}</h4>
                        </div>
                        <p class="whitespace-nowrap text-lg font-extrabold text-primary">$${escapeHtml(item.price)}</p>
                      </div>
                      <p class="text-sm leading-7 text-stone-600 dark:text-stone-400">${escapeHtml(item.description)}</p>
                    </div>
                  </article>
                `).join("")}
              </div>
            </section>
          `)
          .join("")
      }
    }

    if (orderSelect) {
      orderSelect.innerHTML = `
        <option value="">Select a menu item</option>
        ${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} - $${escapeHtml(item.price)}</option>`).join("")}
      `
    }
  } catch (error) {
    if (menuContainer) {
      menuContainer.innerHTML = `
        <div class="rounded-xl border border-dashed border-red-300 p-8 text-center text-red-600 dark:border-red-900 dark:text-red-300">
          ${escapeHtml(error.message)}
        </div>
      `
    }
  }
}

async function attachOrderForm() {
  const orderForm = document.getElementById("orderForm")
  const resultContainer = document.getElementById("orderResult")

  if (!orderForm) {
    return
  }

  orderForm.addEventListener("submit", async (event) => {
    event.preventDefault()

    await withLoadingState(orderForm, event, "Placing Order...", async () => {
      try {
        const payload = serializeForm(orderForm)
        const data = await requestSheets("createOrder", payload)
        const order = data.order

        alert(`Order placed successfully. Your tracking ID is ${order.id}.`)
        renderOrderSummary(resultContainer, order)
        orderForm.reset()
        await loadDynamicMenu()
      } catch (error) {
        alert(error.message)
      }
    })
  })
}

async function attachOrderTrackingForm() {
  const trackingForm = document.getElementById("orderTrackingForm")
  const trackingInput = document.getElementById("trackingOrderId")
  const resultContainer = document.getElementById("trackingResult")

  if (!trackingForm || !trackingInput) {
    return
  }

  trackingForm.addEventListener("submit", async (event) => {
    event.preventDefault()

    const orderId = trackingInput.value.trim()

    if (!orderId) {
      alert("Enter an order ID to track your order.")
      return
    }

    await withLoadingState(trackingForm, event, "Tracking...", async () => {
      try {
        const data = await requestSheets("getOrderById", { id: orderId })
        renderOrderSummary(resultContainer, data.order)
      } catch (error) {
        alert(error.message)
      }
    })
  })
}

function escapeText(value) {
  return escapeHtml(value)
}

function normalizeStatusValue(status, fallback = "pending") {
  const normalized = String(status || "").trim().toLowerCase()
  return normalized || fallback
}

function statusBadge(status) {
  const normalized = normalizeStatusValue(status)
  const styles = {
    pending: "bg-amber-500/10 text-amber-600",
    "on the way": "bg-blue-500/10 text-blue-600",
    delivered: "bg-emerald-500/10 text-emerald-600",
    accepted: "bg-emerald-500/10 text-emerald-600",
    rejected: "bg-red-500/10 text-red-600"
  }
  const cls = styles[normalized] || styles.pending
  const label = String(status || "").trim() || "pending"
  return `<span class="inline-flex rounded-full px-3 py-1 text-xs font-bold ${cls}">${escapeText(label)}</span>`
}

function bookingActionsMarkup(status, bookingId) {
  if (normalizeStatusValue(status) !== "pending") {
    return `<span class="text-xs font-semibold text-stone-400 dark:text-stone-500">No actions</span>`
  }

  const id = escapeText(bookingId)

  return `
    <div class="flex gap-2">
      <button data-booking-accept="${id}" class="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700" type="button">Accept</button>
      <button data-booking-reject="${id}" class="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700" type="button">Reject</button>
    </div>
  `
}

function updateBookingRowState(bookingId, status) {
  const row = document.querySelector(`[data-booking-row="${CSS.escape(String(bookingId))}"]`)

  if (!row) {
    return
  }

  const normalizedStatus = normalizeStatusValue(status)
  const statusCell = row.querySelector("[data-booking-status-cell]")
  const actionsCell = row.querySelector("[data-booking-actions-cell]")

  if (statusCell) {
    statusCell.innerHTML = statusBadge(normalizedStatus)
  }

  if (actionsCell) {
    actionsCell.innerHTML = bookingActionsMarkup(normalizedStatus, bookingId)
  }
}

function setDashboardMessage(message) {
  const itemsCount = document.getElementById("itemsCount")
  const ordersCount = document.getElementById("ordersCount")
  const bookingsCount = document.getElementById("bookingsCount")
  const newsletterCount = document.getElementById("newsletterCount")
  const ordersTable = document.getElementById("ordersTable")
  const bookingsTable = document.getElementById("bookingsTable")
  const itemsTable = document.getElementById("itemsTable")

  if (itemsCount) itemsCount.textContent = "-"
  if (ordersCount) ordersCount.textContent = "-"
  if (bookingsCount) bookingsCount.textContent = "-"
  if (newsletterCount) newsletterCount.textContent = "-"
  if (ordersTable) ordersTable.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">${escapeText(message)}</td></tr>`
  if (bookingsTable) bookingsTable.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="7">${escapeText(message)}</td></tr>`
  if (itemsTable) itemsTable.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">${escapeText(message)}</td></tr>`
}

function setStatusCount(id, value) {
  const element = document.getElementById(id)

  if (element) {
    element.textContent = value ?? 0
  }
}

async function refreshCounts() {
  const dashboard = await requestSheets("getDashboard", {}, { admin: true })

  document.getElementById("itemsCount").textContent = dashboard.itemsCount ?? "-"
  document.getElementById("ordersCount").textContent = dashboard.ordersCount ?? "-"
  document.getElementById("bookingsCount").textContent = dashboard.bookingsCount ?? "-"
  document.getElementById("newsletterCount").textContent = dashboard.newsletterCount ?? "-"

  setStatusCount("ordersPendingCount", dashboard.orderStatuses?.pending || 0)
  setStatusCount("ordersOnTheWayCount", dashboard.orderStatuses?.["on the way"] || 0)
  setStatusCount("ordersDeliveredCount", dashboard.orderStatuses?.delivered || 0)
  setStatusCount("bookingsPendingCount", dashboard.bookingStatuses?.pending || 0)
  setStatusCount("bookingsAcceptedCount", dashboard.bookingStatuses?.accepted || 0)
  setStatusCount("bookingsRejectedCount", dashboard.bookingStatuses?.rejected || 0)
}

async function refreshOrders() {
  const tbody = document.getElementById("ordersTable")

  if (!tbody) {
    return
  }

  tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">Loading...</td></tr>`

  try {
    const data = await requestSheets("getOrders", {}, { admin: true })
    const orders = data.orders || []

    if (!orders.length) {
      tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">No orders yet.</td></tr>`
      return
    }

    tbody.innerHTML = orders
      .slice(0, 20)
      .map((order) => {
        const id = escapeText(order.id)
        const status = escapeText(order.status || "pending")

        return `
          <tr>
            <td class="py-3 pr-4 font-semibold">${id}</td>
            <td class="py-3 pr-4">${escapeText(order.customerName)}</td>
            <td class="py-3 pr-4">${escapeText(order.itemName)} x ${escapeText(order.quantity)}</td>
            <td class="py-3 pr-4 font-semibold text-primary">$${escapeText(order.total)}</td>
            <td class="py-3 pr-4">
              <select data-order-status="${id}" class="rounded-lg border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-950">
                <option value="pending" ${status === "pending" ? "selected" : ""}>pending</option>
                <option value="on the way" ${status === "on the way" ? "selected" : ""}>on the way</option>
                <option value="delivered" ${status === "delivered" ? "selected" : ""}>delivered</option>
              </select>
            </td>
            <td class="py-3 pr-4">
              <button data-order-update="${id}" class="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900" type="button">
                Update
              </button>
            </td>
          </tr>
        `
      })
      .join("")

    document.querySelectorAll("[data-order-update]").forEach((button) => {
      button.addEventListener("click", async () => {
        const orderId = button.getAttribute("data-order-update")
        const select = document.querySelector(`[data-order-status="${CSS.escape(orderId)}"]`)

        await withControlLoading(button, "Updating...", async () => {
          try {
            await requestSheets("updateOrderStatus", {
              id: orderId,
              status: select.value
            }, { admin: true })
            await Promise.all([refreshOrders(), refreshCounts()])
          } catch (error) {
            alert(error.message)
          }
        })
      })
    })
  } catch (error) {
    tbody.innerHTML = `<tr><td class="py-4 text-red-600 dark:text-red-300" colspan="6">${escapeText(error.message)}</td></tr>`
  }
}

async function refreshBookings() {
  const tbody = document.getElementById("bookingsTable")

  if (!tbody) {
    return
  }

  tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="7">Loading...</td></tr>`

  try {
    const data = await requestSheets("getBookings", {}, { admin: true })
    const bookings = data.bookings || []

    if (!bookings.length) {
      tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="7">No booking requests yet.</td></tr>`
      return
    }

    tbody.innerHTML = bookings
      .slice(0, 30)
      .map((booking) => {
        const id = escapeText(booking.id)
        const service = escapeText(booking.serviceType)
        const name = `${escapeText(booking.firstName)} ${escapeText(booking.lastName)}`.trim()
        const status = String(booking.status || "").trim() || "pending"
        const actions = bookingActionsMarkup(status, booking.id)

        return `
          <tr data-booking-row="${id}">
            <td class="py-3 pr-4 font-semibold">${id}</td>
            <td class="py-3 pr-4">${service}</td>
            <td class="py-3 pr-4">${name || "-"}</td>
            <td class="py-3 pr-4">${escapeText(booking.phone) || "-"}</td>
            <td class="py-3 pr-4">${escapeText(booking.date) || "-"}</td>
            <td data-booking-status-cell class="py-3 pr-4">${statusBadge(status)}</td>
            <td data-booking-actions-cell class="py-3 pr-4">${actions}</td>
          </tr>
        `
      })
      .join("")

    document.querySelectorAll("[data-booking-accept]").forEach((button) => {
      button.addEventListener("click", async () => {
        const bookingId = button.getAttribute("data-booking-accept")

        await withControlLoading(button, "Accepting...", async () => {
          try {
            await requestSheets("updateBookingStatus", { id: bookingId, status: "accepted" }, { admin: true })
            updateBookingRowState(bookingId, "accepted")
            await Promise.all([refreshBookings(), refreshCounts()])
          } catch (error) {
            alert(error.message)
          }
        })
      })
    })

    document.querySelectorAll("[data-booking-reject]").forEach((button) => {
      button.addEventListener("click", async () => {
        const bookingId = button.getAttribute("data-booking-reject")

        await withControlLoading(button, "Rejecting...", async () => {
          try {
            await requestSheets("updateBookingStatus", { id: bookingId, status: "rejected" }, { admin: true })
            updateBookingRowState(bookingId, "rejected")
            await Promise.all([refreshBookings(), refreshCounts()])
          } catch (error) {
            alert(error.message)
          }
        })
      })
    })
  } catch (error) {
    tbody.innerHTML = `<tr><td class="py-4 text-red-600 dark:text-red-300" colspan="7">${escapeText(error.message)}</td></tr>`
  }
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onerror = () => reject(new Error("Could not read the selected image file."))
    reader.onload = () => resolve(String(reader.result || ""))
    reader.readAsDataURL(file)
  })
}

async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onerror = () => reject(new Error("The selected image file is invalid."))
    image.onload = () => resolve(image)
    image.src = src
  })
}

async function resizeImageFile(file) {
  const originalDataUrl = await readFileAsDataUrl(file)
  const image = await loadImageElement(originalDataUrl)
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")

  if (!context) {
    throw new Error("Could not process the selected image file.")
  }

  const widths = [420, 320, 240, 180, 140]
  const qualities = [0.72, 0.56, 0.42, 0.32, 0.24]

  for (const maxWidth of widths) {
    const scale = Math.min(1, maxWidth / image.width)
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality)

      if (dataUrl.length <= LEGACY_INLINE_IMAGE_LIMIT) {
        return dataUrl
      }
    }
  }

  return ""
}

async function prepareMenuImageUpload(file) {
  if (!file) {
    return null
  }

  if (file.size > MAX_MENU_IMAGE_BYTES) {
    throw new Error("The selected image must be 10MB or smaller.")
  }

  const imageData = await readFileAsDataUrl(file)
  const legacyImageUrl = await resizeImageFile(file)

  return {
    imageData,
    imageFileName: file.name || "menu-image",
    imageMimeType: file.type || "image/jpeg",
    legacyImageUrl
  }
}

async function saveMenuItem(payload, isEditing) {
  try {
    return await requestSheets(isEditing ? "updateItem" : "createItem", payload, { admin: true })
  } catch (error) {
    if (!isEditing || !isUnsupportedActionError(error, "updateItem")) {
      throw error
    }

    // Fallback for older Apps Script deployments that do not support updateItem yet.
    const created = await requestSheets("createItem", {
      name: payload.name,
      category: payload.category,
      description: payload.description,
      price: payload.price,
      imageUrl: payload.imageUrl
    }, { admin: true })

    await requestSheets("deleteItem", { id: payload.id }, { admin: true })
    return created
  }
}

function getImageUploadWarning(imageUpload, savedData) {
  if (!imageUpload || imageUpload.legacyImageUrl || savedData?.item?.imageUrl) {
    return ""
  }

  return " The item was saved, but this local image needs the latest Apps Script deployment to upload large files. Redeploy `google-apps-script/Code.gs`, or use an image URL."
}

function setItemFormMode(isEditing) {
  const formTitle = document.getElementById("itemFormTitle")
  const formDescription = document.getElementById("itemFormDescription")
  const submitButton = document.getElementById("itemFormSubmitButton")
  const cancelButton = document.getElementById("cancelItemEditButton")

  if (formTitle) {
    formTitle.textContent = isEditing ? "Edit Menu Item" : "Add Menu Item"
  }

  if (formDescription) {
    formDescription.textContent = isEditing
      ? "Update the selected menu item and save the changes to Google Sheets."
      : "Items appear on the public menu once saved to Google Sheets."
  }

  if (submitButton) {
    submitButton.textContent = isEditing ? "Save Changes" : "Add Item"
  }

  if (cancelButton) {
    cancelButton.classList.toggle("hidden", !isEditing)
  }
}

async function attachAddItemForm() {
  const form = document.getElementById("addItemForm")
  const itemIdInput = document.getElementById("itemId")
  const fileInput = document.getElementById("itemImageFile")
  const urlInput = document.getElementById("itemImageUrl")
  const previewContainer = document.getElementById("imagePreviewContainer")
  const previewImage = document.getElementById("imagePreview")
  const nameInput = document.getElementById("itemName")
  const categoryInput = document.getElementById("itemCategory")
  const priceInput = document.getElementById("itemPrice")
  const descriptionInput = document.getElementById("itemDescription")
  const cancelEditButton = document.getElementById("cancelItemEditButton")

  if (!form || !itemIdInput || !fileInput || !urlInput || !previewContainer || !previewImage || !nameInput || !categoryInput || !priceInput || !descriptionInput || !cancelEditButton) {
    return
  }

  const resetItemForm = () => {
    form.reset()
    itemIdInput.value = ""
    fileInput.value = ""
    previewImage.src = ""
    previewContainer.classList.add("hidden")
    setItemFormMode(false)
  }

  window.sebliAdminItemEditor = {
    startEdit(item) {
      itemIdInput.value = item.id || ""
      nameInput.value = item.name || ""
      categoryInput.value = item.category || ""
      priceInput.value = item.price || ""
      descriptionInput.value = item.description || ""
      urlInput.value = item.imageUrl || ""
      fileInput.value = ""

      if (item.imageUrl) {
        previewImage.src = normalizeImageSource(item.imageUrl)
        previewContainer.classList.remove("hidden")
      } else {
        previewImage.src = ""
        previewContainer.classList.add("hidden")
      }

      setItemFormMode(true)
      form.scrollIntoView({ behavior: "smooth", block: "start" })
      nameInput.focus()
    },
    reset: resetItemForm
  }

  setItemFormMode(false)

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0]

    if (!file) {
      previewContainer.classList.add("hidden")
      return
    }

    const previewUrl = URL.createObjectURL(file)
    previewImage.src = previewUrl
    previewContainer.classList.remove("hidden")
    urlInput.value = ""
  })

  urlInput.addEventListener("input", () => {
    if (urlInput.value.trim()) {
      previewImage.src = urlInput.value.trim()
      previewContainer.classList.remove("hidden")
      fileInput.value = ""
      return
    }

    previewContainer.classList.add("hidden")
  })

  cancelEditButton.addEventListener("click", () => {
    resetItemForm()
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()

    const payload = serializeForm(form)
    const itemId = String(payload.id || "").trim()
    const isEditing = Boolean(itemId)
    const name = String(payload.name || "").trim()
    const description = String(payload.description || "").trim()
    const price = Number.parseFloat(payload.price || 0)
    const category = String(payload.category || "Featured").trim() || "Featured"
    const imageFile = fileInput.files[0]
    let imageUrl = String(payload.imageUrl || "").trim()
    let imageData = ""
    let imageFileName = ""
    let imageMimeType = ""

    if (!name || !description || price <= 0) {
      alert("Please enter the item name, description, and a valid price.")
      return
    }

    await withLoadingState(form, event, isEditing ? "Saving Changes..." : "Adding Item...", async () => {
      try {
        let imageUpload = null

        if (imageFile) {
          imageUpload = await prepareMenuImageUpload(imageFile)
          imageUrl = imageUpload.legacyImageUrl || imageUrl
          imageData = imageUpload.imageData
          imageFileName = imageUpload.imageFileName
          imageMimeType = imageUpload.imageMimeType
        }

        const savedData = await saveMenuItem({
          id: itemId,
          name,
          category,
          description,
          price: price.toFixed(2),
          imageUrl,
          imageData,
          imageFileName,
          imageMimeType
        }, isEditing)

        alert(`${isEditing ? "Menu item updated successfully!" : "Menu item added successfully!"}${getImageUploadWarning(imageUpload, savedData)}`)
        resetItemForm()
        await Promise.all([refreshItems(), refreshCounts()])
      } catch (error) {
        alert(error.message)
      }
    })
  })
}

async function refreshItems() {
  const tbody = document.getElementById("itemsTable")

  if (!tbody) {
    return
  }

  tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">Loading menu items...</td></tr>`

  try {
    const data = await requestSheets("getItems", {}, { admin: true })
    const items = data.items || []

    if (!items.length) {
      tbody.innerHTML = `<tr><td class="py-4 text-stone-500 dark:text-stone-400" colspan="6">No menu items yet.</td></tr>`
      return
    }

    tbody.innerHTML = items
      .map((item) => `
        <tr>
          <td class="py-3 pr-4">
            <img
              src="${escapeText(normalizeImageSource(item.imageUrl || "menu-2.jpg"))}"
              alt="${escapeText(item.name)}"
              class="h-12 w-12 rounded-lg object-cover"
              onerror="this.src='menu-2.jpg'"
            />
          </td>
          <td class="py-3 pr-4 font-semibold">${escapeText(item.name)}</td>
          <td class="py-3 pr-4">${escapeText(item.category || "Featured")}</td>
          <td class="py-3 pr-4 font-semibold text-primary">$${escapeText(item.price)}</td>
          <td class="py-3 pr-4 max-w-xs truncate text-sm text-stone-600 dark:text-stone-400">${escapeText(item.description)}</td>
          <td class="py-3 pr-4">
            <div class="flex gap-2">
              <button data-item-edit="${escapeText(item.id)}" class="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-bold hover:bg-stone-50 dark:border-stone-800 dark:bg-stone-950 dark:hover:bg-stone-900" type="button">
                Edit
              </button>
              <button data-item-remove="${escapeText(item.id)}" class="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700" type="button">
                Remove
              </button>
            </div>
          </td>
        </tr>
      `)
      .join("")

    document.querySelectorAll("[data-item-edit]").forEach((button) => {
      button.addEventListener("click", () => {
        const itemId = button.getAttribute("data-item-edit")
        const item = items.find((entry) => entry.id === itemId)

        if (item) {
          window.sebliAdminItemEditor?.startEdit(item)
        }
      })
    })

    document.querySelectorAll("[data-item-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        const itemId = button.getAttribute("data-item-remove")
        const row = button.closest("tr")
        const itemName = row?.querySelector("td:nth-child(2)")?.textContent || "this item"

        if (!confirm(`Are you sure you want to remove "${itemName}" from the menu?`)) {
          return
        }

        await withControlLoading(button, "Removing...", async () => {
          try {
            await requestSheets("deleteItem", { id: itemId }, { admin: true })
            if (document.getElementById("itemId")?.value === itemId) {
              window.sebliAdminItemEditor?.reset()
            }
            row?.remove()
            await Promise.all([refreshItems(), refreshCounts()])
          } catch (error) {
            alert(error.message)
          }
        })
      })
    })
  } catch (error) {
    tbody.innerHTML = `<tr><td class="py-4 text-red-600 dark:text-red-300" colspan="6">${escapeText(error.message)}</td></tr>`
  }
}

async function loadAdminData() {
  const authBadge = document.getElementById("authBadge")

  if (!authBadge) {
    return
  }

  authBadge.innerHTML = '<span class="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true"></span><span>Checking Google Sheets access...</span>'

  try {
    await verifyAdminAccess()
    authBadge.innerHTML = '<span class="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true"></span><span>Google Sheets connected</span>'
    await Promise.all([refreshCounts(), refreshItems(), refreshOrders(), refreshBookings()])
  } catch (error) {
    authBadge.innerHTML = `<span class="h-2 w-2 rounded-full bg-red-500" aria-hidden="true"></span><span>${escapeText(error.message)}</span>`
    setDashboardMessage(error.message)
    throw error
  }
}

function initAdminLoginPage() {
  const loginForm = document.getElementById("adminLoginForm")
  const passwordInput = document.getElementById("adminPassword")
  const loginMessage = document.getElementById("loginMessage")

  if (!loginForm || !passwordInput || !loginMessage) {
    return
  }

  if (hasAdminAccess()) {
    verifyAdminAccess()
      .then(() => window.location.replace("admin.html"))
      .catch(() => clearAdminAccess())
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault()
    loginMessage.classList.add("hidden")
    loginMessage.textContent = ""

    await withLoadingState(loginForm, event, "Signing In...", async () => {
      try {
        await saveAdminAccess(passwordInput.value)
        window.location.replace("admin.html")
      } catch (error) {
        loginMessage.textContent = error.message
        loginMessage.classList.remove("hidden")
        passwordInput.select()
      }
    })
  })
}

async function initAdminPage() {
  const logoutButton = document.getElementById("logoutButton")
  const refreshOrdersButton = document.getElementById("refreshOrders")
  const refreshBookingsButton = document.getElementById("refreshBookings")
  const refreshItemsButton = document.getElementById("refreshItems")

  if (!logoutButton) {
    return
  }

  if (!hasAdminAccess()) {
    window.location.replace("admin-login.html")
    return
  }

  document.getElementById("tokenStatus").textContent = "Admin access is unlocked in this browser session."

  logoutButton.addEventListener("click", async () => {
    await withControlLoading(logoutButton, "Signing Out...", async () => {
      clearAdminAccess()
      window.location.replace("admin-login.html")
    })
  })

  refreshOrdersButton?.addEventListener("click", async () => {
    await withControlLoading(refreshOrdersButton, "Refreshing...", loadAdminData)
  })

  refreshBookingsButton?.addEventListener("click", async () => {
    await withControlLoading(refreshBookingsButton, "Refreshing...", loadAdminData)
  })

  refreshItemsButton?.addEventListener("click", async () => {
    await withControlLoading(refreshItemsButton, "Refreshing...", loadAdminData)
  })

  await attachAddItemForm()

  try {
    await loadAdminData()
  } catch (error) {
    if (/incorrect admin password/i.test(String(error.message || ""))) {
      clearAdminAccess()
      window.location.replace("admin-login.html")
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  attachBookingForms()
  attachNewsletterForms()
  loadDynamicMenu()
  attachOrderForm()
  attachOrderTrackingForm()
  initAdminLoginPage()
  initAdminPage()
})

window.sebliAdminAuth = {
  login: saveAdminAccess,
  logout: clearAdminAccess,
  isAuthenticated: hasAdminAccess,
  verify: verifyAdminAccess
}

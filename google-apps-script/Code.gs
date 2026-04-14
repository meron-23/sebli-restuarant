const DEFAULT_SPREADSHEET_ID = "1OuVbUpXMj8C47ZcZNGQBChixuB0X0Ic7xS6CnPhp-2c";

const SHEET_SCHEMAS = {
  Items: [
    "id",
    "name",
    "category",
    "description",
    "price",
    "imageUrl",
    "createdAt",
    "updatedAt"
  ],
  Orders: [
    "id",
    "customerName",
    "phone",
    "email",
    "itemId",
    "itemName",
    "quantity",
    "total",
    "status",
    "notes",
    "createdAt",
    "updatedAt"
  ],
  Bookings: [
    "id",
    "serviceType",
    "firstName",
    "lastName",
    "phone",
    "email",
    "guests",
    "date",
    "time",
    "startTime",
    "endTime",
    "eventType",
    "budget",
    "venueAddress",
    "cateringPackage",
    "hookahFlavors",
    "dietaryRestrictions",
    "details",
    "status",
    "createdAt",
    "updatedAt"
  ],
  Newsletter: [
    "id",
    "email",
    "status",
    "createdAt",
    "updatedAt"
  ]
};

const ORDER_STATUSES = ["pending", "on the way", "delivered"];
const BOOKING_STATUSES = ["pending", "accepted", "rejected"];
const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function setupSpreadsheet() {
  ensureWorkbookStructure_();
  const spreadsheet = getSpreadsheet_();
  spreadsheet.rename("Sebli Restaurant Admin");

  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    sheets: spreadsheet.getSheets().map(function (sheet) {
      return sheet.getName();
    })
  };
}

function clearAllDataKeepHeaders() {
  ensureWorkbookStructure_();
  return clearAllData_();
}

function handleRequest_(event) {
  try {
    const payload = parseRequestPayload_(event);
    const action = String(payload.action || "").trim();

    if (!action) {
      throw new Error("Missing action.");
    }

    ensureWorkbookStructure_();

    let data;

    switch (action) {
      case "verifyAdmin":
        validateAdmin_(payload.adminPassword);
        data = { authenticated: true };
        break;
      case "getPublicItems":
        data = { items: sortByNewest_(readRecords_("Items")) };
        break;
      case "createItem":
        validateAdmin_(payload.adminPassword);
        data = { item: createItem_(payload) };
        break;
      case "updateItem":
        validateAdmin_(payload.adminPassword);
        data = { item: updateItem_(payload) };
        break;
      case "deleteItem":
        validateAdmin_(payload.adminPassword);
        data = { item: deleteRecordById_("Items", payload.id) };
        break;
      case "getItems":
        validateAdmin_(payload.adminPassword);
        data = { items: sortByNewest_(readRecords_("Items")) };
        break;
      case "createOrder":
        data = { order: createOrder_(payload) };
        break;
      case "getOrderById":
        data = { order: getOrderById_(payload.id) };
        break;
      case "getOrders":
        validateAdmin_(payload.adminPassword);
        data = { orders: sortByNewest_(readRecords_("Orders")) };
        break;
      case "updateOrderStatus":
        validateAdmin_(payload.adminPassword);
        data = { order: updateOrderStatus_(payload.id, payload.status) };
        break;
      case "createBooking":
        data = { booking: createBooking_(payload) };
        break;
      case "getBookings":
        validateAdmin_(payload.adminPassword);
        data = { bookings: sortByNewest_(readRecords_("Bookings")) };
        break;
      case "updateBookingStatus":
        validateAdmin_(payload.adminPassword);
        data = { booking: updateBookingStatus_(payload.id, payload.status) };
        break;
      case "subscribeNewsletter":
        data = subscribeNewsletter_(payload.email);
        break;
      case "getDashboard":
        validateAdmin_(payload.adminPassword);
        data = getDashboardData_();
        break;
      case "clearAllData":
        validateAdmin_(payload.adminPassword);
        data = clearAllData_();
        break;
      default:
        throw new Error("Unsupported action: " + action);
    }

    return jsonResponse_({ ok: true, data: data });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : "Unexpected Google Sheets error."
    });
  }
}

function parseRequestPayload_(event) {
  const raw = event && event.postData && event.postData.contents ? event.postData.contents : "";

  if (raw) {
    return JSON.parse(raw);
  }

  return (event && event.parameter) || {};
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SEBLI_SPREADSHEET_ID") || DEFAULT_SPREADSHEET_ID;

  if (!spreadsheetId) {
    throw new Error("Missing spreadsheet ID. Set SEBLI_SPREADSHEET_ID in Apps Script properties.");
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function ensureWorkbookStructure_() {
  const spreadsheet = getSpreadsheet_();

  Object.keys(SHEET_SCHEMAS).forEach(function (sheetName) {
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    const headers = SHEET_SCHEMAS[sheetName];
    const existingHeaders = sheet.getLastColumn() > 0 ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
    const hasSameHeaders = headers.every(function (header, index) {
      return existingHeaders[index] === header;
    });

    if (!hasSameHeaders) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  });
}

function readRecords_(sheetName) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  return values
    .map(function (row, index) {
      return {
        row: row,
        rowNumber: index + 2
      };
    })
    .filter(function (entry) {
      return entry.row.some(function (value) {
        return String(value || "").trim() !== "";
      });
    })
    .map(function (entry) {
      const record = { _rowNumber: entry.rowNumber };

      headers.forEach(function (header, headerIndex) {
        record[header] = entry.row[headerIndex] === null ? "" : String(entry.row[headerIndex] || "");
      });

      return record;
    });
}

function appendRecord_(sheetName, record) {
  const headers = SHEET_SCHEMAS[sheetName];
  const row = headers.map(function (header) {
    return record[header] || "";
  });

  getSheet_(sheetName).appendRow(row);
  return record;
}

function updateRecordById_(sheetName, id, patch) {
  const sheet = getSheet_(sheetName);
  const headers = SHEET_SCHEMAS[sheetName];
  const records = readRecords_(sheetName);
  const existing = records.find(function (record) {
    return record.id === String(id || "");
  });

  if (!existing) {
    throw new Error(sheetName.slice(0, -1) + " not found.");
  }

  const updated = Object.assign({}, existing, patch, {
    updatedAt: nowIso_()
  });

  const row = headers.map(function (header) {
    return updated[header] || "";
  });

  sheet.getRange(existing._rowNumber, 1, 1, headers.length).setValues([row]);
  return updated;
}

function deleteRecordById_(sheetName, id) {
  const sheet = getSheet_(sheetName);
  const records = readRecords_(sheetName);
  const existing = records.find(function (record) {
    return record.id === String(id || "");
  });

  if (!existing) {
    throw new Error(sheetName.slice(0, -1) + " not found.");
  }

  sheet.deleteRow(existing._rowNumber);
  return existing;
}

function getSheet_(sheetName) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }

  return sheet;
}

function createItem_(payload) {
  const name = clean_(payload.name);
  const description = clean_(payload.description);
  const category = clean_(payload.category) || "Featured";
  const price = formatPrice_(payload.price);

  if (!name || !description || Number(price) <= 0) {
    throw new Error("Item name, description, and a valid price are required.");
  }

  return withLock_(function () {
    const imageUrl = resolveItemImageUrl_(payload);

    return appendRecord_("Items", {
      id: createId_("ITEM"),
      name: name,
      category: category,
      description: description,
      price: price,
      imageUrl: imageUrl,
      createdAt: nowIso_(),
      updatedAt: nowIso_()
    });
  });
}

function updateItem_(payload) {
  const id = clean_(payload.id);
  const name = clean_(payload.name);
  const description = clean_(payload.description);
  const category = clean_(payload.category) || "Featured";
  const price = formatPrice_(payload.price);

  if (!id) {
    throw new Error("Item ID is required.");
  }

  if (!name || !description || Number(price) <= 0) {
    throw new Error("Item name, description, and a valid price are required.");
  }

  return withLock_(function () {
    const existing = readRecords_("Items").find(function (entry) {
      return entry.id === id;
    });

    if (!existing) {
      throw new Error("Item not found.");
    }

    const imageUrl = resolveItemImageUrl_(payload, existing.imageUrl);

    return updateRecordById_("Items", id, {
      name: name,
      category: category,
      description: description,
      price: price,
      imageUrl: imageUrl
    });
  });
}

function resolveItemImageUrl_(payload, existingImageUrl) {
  const inlineImageUrl = clean_(payload.imageUrl);
  const imageData = clean_(payload.imageData);

  if (imageData) {
    return saveImageDataToDrive_(imageData, payload.imageFileName, payload.imageMimeType);
  }

  if (inlineImageUrl) {
    return inlineImageUrl;
  }

  return typeof existingImageUrl === "string" ? existingImageUrl : "";
}

function saveImageDataToDrive_(dataUrl, fileName, fallbackMimeType) {
  const matches = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);

  if (!matches) {
    throw new Error("The selected image data is invalid.");
  }

  const mimeType = clean_(matches[1]) || clean_(fallbackMimeType) || "image/jpeg";
  const bytes = Utilities.base64Decode(matches[2]);

  if (bytes.length > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("The selected image must be 10MB or smaller.");
  }

  const safeExtension = mimeType.split("/")[1] || "jpg";
  const safeName = clean_(fileName) || ("menu-image-" + nowIso_().replace(/[:.]/g, "-") + "." + safeExtension);
  const blob = Utilities.newBlob(bytes, mimeType, safeName);
  const folderId = PropertiesService.getScriptProperties().getProperty("SEBLI_DRIVE_FOLDER_ID");
  const file = folderId
    ? DriveApp.getFolderById(folderId).createFile(blob)
    : DriveApp.createFile(blob);

  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return "https://drive.google.com/uc?export=view&id=" + file.getId();
}

function createOrder_(payload) {
  const customerName = clean_(payload.customerName);
  const phone = clean_(payload.phone);
  const email = clean_(payload.email);
  const itemId = clean_(payload.itemId);
  const quantity = Math.max(1, parseInt(payload.quantity, 10) || 1);
  const notes = clean_(payload.notes);

  if (!customerName || !phone || !itemId) {
    throw new Error("Customer name, phone, and item selection are required.");
  }

  return withLock_(function () {
    const item = readRecords_("Items").find(function (entry) {
      return entry.id === itemId;
    });

    if (!item) {
      throw new Error("Selected menu item was not found.");
    }

    const total = formatPrice_(parseFloat(item.price || "0") * quantity);
    const now = nowIso_();

    return appendRecord_("Orders", {
      id: createId_("ORD"),
      customerName: customerName,
      phone: phone,
      email: email,
      itemId: item.id,
      itemName: item.name,
      quantity: String(quantity),
      total: total,
      status: "pending",
      notes: notes,
      createdAt: now,
      updatedAt: now
    });
  });
}

function getOrderById_(id) {
  const order = readRecords_("Orders").find(function (entry) {
    return entry.id === String(id || "");
  });

  if (!order) {
    throw new Error("Order not found.");
  }

  return order;
}

function updateOrderStatus_(id, status) {
  const normalizedStatus = clean_(status).toLowerCase();

  if (ORDER_STATUSES.indexOf(normalizedStatus) === -1) {
    throw new Error("Order status must be pending, on the way, or delivered.");
  }

  return withLock_(function () {
    return updateRecordById_("Orders", id, { status: normalizedStatus });
  });
}

function createBooking_(payload) {
  const booking = normalizeBookingPayload_(payload);

  if (!booking.firstName || !booking.phone || !booking.date) {
    throw new Error("First name, phone number, and date are required for bookings.");
  }

  return withLock_(function () {
    return appendRecord_("Bookings", booking);
  });
}

function updateBookingStatus_(id, status) {
  const normalizedStatus = clean_(status).toLowerCase();

  if (BOOKING_STATUSES.indexOf(normalizedStatus) === -1) {
    throw new Error("Booking status must be pending, accepted, or rejected.");
  }

  return withLock_(function () {
    return updateRecordById_("Bookings", id, { status: normalizedStatus });
  });
}

function subscribeNewsletter_(emailValue) {
  const email = clean_(emailValue).toLowerCase();

  if (!email) {
    throw new Error("Email is required.");
  }

  return withLock_(function () {
    const existing = readRecords_("Newsletter").find(function (entry) {
      return String(entry.email || "").toLowerCase() === email;
    });

    if (existing) {
      return {
        duplicate: true,
        email: email
      };
    }

    const now = nowIso_();
    appendRecord_("Newsletter", {
      id: createId_("SUB"),
      email: email,
      status: "subscribed",
      createdAt: now,
      updatedAt: now
    });

    return {
      duplicate: false,
      email: email
    };
  });
}

function getDashboardData_() {
  const items = readRecords_("Items");
  const orders = readRecords_("Orders");
  const bookings = readRecords_("Bookings");
  const newsletter = readRecords_("Newsletter");

  return {
    itemsCount: items.length,
    ordersCount: orders.length,
    bookingsCount: bookings.length,
    newsletterCount: newsletter.length,
    orderStatuses: countStatuses_(orders, ORDER_STATUSES),
    bookingStatuses: countStatuses_(bookings, BOOKING_STATUSES)
  };
}

function clearAllData_() {
  return withLock_(function () {
    const removedCounts = {};

    Object.keys(SHEET_SCHEMAS).forEach(function (sheetName) {
      const sheet = getSheet_(sheetName);
      const lastRow = sheet.getLastRow();
      const rowsToDelete = Math.max(0, lastRow - 1);

      if (rowsToDelete > 0) {
        sheet.deleteRows(2, rowsToDelete);
      }

      removedCounts[sheetName] = rowsToDelete;
    });

    return {
      cleared: true,
      removedCounts: removedCounts
    };
  });
}

function normalizeBookingPayload_(payload) {
  const now = nowIso_();

  return {
    id: createId_("BKG"),
    serviceType: clean_(payload.serviceType),
    firstName: clean_(payload.firstName || payload["first-name"]),
    lastName: clean_(payload.lastName || payload["last-name"]),
    phone: clean_(payload.phone || payload.phoneNumber || payload["phone-number"]),
    email: clean_(payload.email),
    guests: clean_(payload.guests),
    date: clean_(payload.date),
    time: clean_(payload.time),
    startTime: clean_(payload.startTime || payload["start-time"]),
    endTime: clean_(payload.endTime || payload["end-time"]),
    eventType: clean_(payload.eventType || payload["event-type"]),
    budget: clean_(payload.budget),
    venueAddress: clean_(payload.venueAddress || payload["venue-address"]),
    cateringPackage: clean_(payload.cateringPackage || payload["catering-package"]),
    hookahFlavors: clean_(payload.hookahFlavors || payload["hookah-flavors"]),
    dietaryRestrictions: clean_(payload.dietaryRestrictions || payload["dietary-restrictions"]),
    details: clean_(payload.details || payload["special-requests"] || payload.specialRequests),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
}

function validateAdmin_(password) {
  const configuredPassword = PropertiesService.getScriptProperties().getProperty("SEBLI_ADMIN_PASSWORD");

  if (!configuredPassword) {
    throw new Error("Admin password is not configured in Apps Script properties.");
  }

  if (clean_(password) !== configuredPassword) {
    throw new Error("Incorrect admin password.");
  }
}

function countStatuses_(records, statuses) {
  const counts = {};

  statuses.forEach(function (status) {
    counts[status] = 0;
  });

  records.forEach(function (record) {
    const status = String(record.status || "").toLowerCase();

    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  });

  return counts;
}

function sortByNewest_(records) {
  return records.sort(function (left, right) {
    return String(right.createdAt || "").localeCompare(String(left.createdAt || ""));
  });
}

function withLock_(handler) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    return handler();
  } finally {
    lock.releaseLock();
  }
}

function createId_(prefix) {
  return [
    prefix,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyMMddHHmmss"),
    Math.random().toString(36).slice(2, 8).toUpperCase()
  ].join("-");
}

function nowIso_() {
  return new Date().toISOString();
}

function clean_(value) {
  return String(value || "").trim();
}

function formatPrice_(value) {
  const numericValue = parseFloat(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : "0.00";
}

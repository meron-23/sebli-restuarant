# Google Sheets Setup

This site no longer uses the old Node/Express backend. Public pages and the admin dashboard now expect a deployed Google Apps Script web app that reads and writes directly to Google Sheets.

## Sheet Tabs

Use one spreadsheet with these tabs and columns:

### `Items`

`id`, `name`, `category`, `description`, `price`, `imageUrl`, `createdAt`, `updatedAt`

### `Orders`

`id`, `customerName`, `phone`, `email`, `itemId`, `itemName`, `quantity`, `total`, `status`, `notes`, `createdAt`, `updatedAt`

### `Bookings`

`id`, `serviceType`, `firstName`, `lastName`, `phone`, `email`, `guests`, `date`, `time`, `startTime`, `endTime`, `eventType`, `budget`, `venueAddress`, `cateringPackage`, `hookahFlavors`, `dietaryRestrictions`, `details`, `status`, `createdAt`, `updatedAt`

### `Newsletter`

`id`, `email`, `status`, `createdAt`, `updatedAt`

The included Apps Script code creates these tabs and headers automatically if they do not exist.

## Deploy Apps Script

1. Open [script.google.com](https://script.google.com/).
2. Create a new Apps Script project.
3. Replace the default script with the contents of `google-apps-script/Code.gs`.
4. Open `Project Settings` and add these Script Properties:
   - `SEBLI_SPREADSHEET_ID` = `1OuVbUpXMj8C47ZcZNGQBChixuB0X0Ic7xS6CnPhp-2c`
   - `SEBLI_ADMIN_PASSWORD` = your real admin password
   - `SEBLI_DRIVE_FOLDER_ID` = optional Google Drive folder id for uploaded menu images
5. Click `Deploy` -> `New deployment`.
6. Choose `Web app`.
7. Set `Execute as` to `Me`.
8. Set access to `Anyone` or `Anyone with the link`.
9. Deploy and copy the `/exec` URL.

## If You Only See "Untitled"

If the spreadsheet opens as `Untitled spreadsheet` or looks empty:

1. Open the Apps Script project.
2. Select the `setupSpreadsheet` function.
3. Click `Run`.
4. Approve permissions with `bikatvon@gmail.com`.
5. Open the spreadsheet again.

That function renames the spreadsheet to `Sebli Restaurant Admin` and creates the `Items`, `Orders`, `Bookings`, and `Newsletter` tabs.

## Frontend Config

1. Open `sheets-config.js`.
2. Paste the deployed Apps Script `/exec` URL into `appsScriptUrl`.
3. Save the file.

Example:

```js
window.SEBLI_SHEETS_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/your-deployment-id/exec",
  spreadsheetId: "1OuVbUpXMj8C47ZcZNGQBChixuB0X0Ic7xS6CnPhp-2c",
  spreadsheetName: "Sebli Restaurant Admin"
}
```

## Notes

- Menu images can be saved by URL, or uploaded from the admin page as local files up to 10MB.
- Large local uploads are stored in Google Drive by Apps Script, and the saved Drive URL is written to the `imageUrl` column in Sheets.
- If you change `google-apps-script/Code.gs`, you must redeploy the Apps Script web app before the website can use the new actions.
- Admin protection is now validated by Apps Script instead of the removed Node server.
- If the dashboard says Google Sheets is not configured, verify `sheets-config.js` has the deployed `/exec` URL.

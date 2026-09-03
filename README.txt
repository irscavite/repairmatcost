CONTAINER REPAIR MATERIALS - LOCAL APP
======================================

HOW TO RUN
1. Extract this ZIP file.
2. Keep all files together in the same folder.
3. Double-click index.html.
4. The app will open in your default web browser.

No installation or web server is required. An internet connection is required to load and save records in Firebase.

SAVED RECORDS
- Records are saved in Firebase Realtime Database under /repairRecords.
- Open the app from any computer or browser to see the same saved records.
- The app clears records from the previous local-storage version once when this Firebase version first opens.
- New records are no longer limited to the browser's local-storage capacity.
- Internet access and Firebase database rules that allow the app to read/write are required.

FIREBASE RULES SETUP
- The file firebase-database.rules.json contains the complete rules required by this app.
- In Firebase Console, open Realtime Database > Rules.
- Replace the rules with the contents of firebase-database.rules.json, then click Publish.
- These rules allow public read/write access because this local app does not use Firebase Authentication. Add authentication before using the app outside a trusted internal setup.

FEATURES
- Every field is optional. Records can be saved even when some or all fields are empty.
- The repair date defaults to yesterday for daily encoding.
- Every material row uses the same complete Material Specs dropdown. Existing saved specifications are also preserved when a record is edited, and the field may be left blank.
- The NAILS damage option converts pieces to thousands automatically: Material Auto Qty = Damage Qty ÷ 1,000.
- Select the NO MATERIAL USED damage option when no consumable material was used; it auto-fills No Material Used with zero quantity.
- Labor Cost, Material Cost, and W. Wash are included with an automatic total.
- Open a saved record and select Edit Record to update it.
- Delete Record removes a saved container from Firebase after confirmation.
- The records screen loads only the latest saved record by default to stay fast.
- Saved records can be filtered using From and To repair dates; Firebase then loads only the matching range.
- Export Excel downloads the currently filtered records as a formatted XLSX workbook.
- Record information and damage information are merged across their material rows to avoid repeated values.
- Print Records prints the currently filtered records using a compact A4 landscape layout, allowing multiple containers per page.

FILES
- index.html         App page
- styles.css         App design and mobile layout
- app.js             Form, calculations, validation, and saved records
- material-data.js   Damage/material/specification database
- firebase-database.rules.json  Firebase Realtime Database rules
- README.txt         These instructions

# Data Dictionary

## Products
- Part Number: unique immutable code.
- Part Name: customer-facing description.
- Category/Brand/Vehicle Model: search and filtering attributes.
- MRP/Dealer Price: numeric INR values.
- Available Stock/Reorder Level: stock monitoring inputs.
- Image File: exact filename in the products image folder.
- Status: Active, Inactive or Discontinued.

## Stock Update
Free Stock is calculated as Available Stock minus Reserved Stock.

## Dealers
Dealer Code is the unique key. Demo Password must not be used in production.

## Orders
Order Number is unique. Line Amount equals Quantity multiplied by Unit Price.

# Replacing Stripe Plans with the 5 New Talexia Plans

This replaces all previous Stripe subscription products with the new 5 plans and retires the old ones.

## New plans

| Code     | Name                     | Price/mo | Category         | Who publishes | Post limit |
|----------|--------------------------|----------|------------------|---------------|------------|
| CO       | Calendar Only            | $15      | CALENDAR_ONLY    | Client        | Unlimited  |
| VCP-15   | Visual Calendar          | $225     | VISUAL_CALENDAR  | Client        | 15 (soft)  |
| FMP-20   | Full Management          | $295     | FULL_MANAGEMENT  | Admin         | 20 (hard)  |
| FMP-35   | Full Management Plus     | $395     | FULL_MANAGEMENT  | Admin         | 35 (hard)  |
| FM-70    | Full Management Premium  | $695     | FULL_MANAGEMENT  | Admin         | 70 (hard)  |

Founder pricing (30% off) is stored in product metadata and applied at checkout when eligible.

## Steps

1. **Backup**  
   In Stripe Dashboard: note or export existing products/prices if you need a record.

2. **Run the script** (from `talexia-backend`):
   ```bash
   cd talexia-backend
   npm run stripe:replace-plans
   ```
   Requires `STRIPE_SECRET_KEY` in `.env`.

3. **What the script does**
   - Creates the 5 products above (or updates metadata if they already exist).
   - Creates monthly recurring prices in USD.
   - **Deactivates** every other Stripe product (old plans).  
   - Existing subscribers are unchanged; they keep their current Stripe subscription. Only the product is deactivated so it no longer appears for new signups.

4. **Sync Stripe → DB**
   - Restart the backend. On startup it runs `syncPlansFromStripe()` and upserts the 5 plans into the `Plan` table from Stripe.
   - Old plan rows in the DB are left as-is so existing subscriptions still resolve. New signups use the 5 new plan codes.

## Optional: clean up old plans in the DB

If you want to remove old plan rows from the database (only after you're sure no active subscriptions reference them):

```sql
-- Example: delete plans that are not in the new 5 (run only after checking subscriptions)
-- DELETE FROM "Plan" WHERE code NOT IN ('CO', 'VCP-15', 'FMP-20', 'FMP-35', 'FM-70');
```

Prefer doing this only when you've migrated or cancelled all subscriptions on old plans.

---

## Adding yearly prices (80% of monthly × 12)

To enable the "Yearly" option on the pricing page, create yearly recurring prices in Stripe:

1. **From `talexia-backend`** (with `STRIPE_SECRET_KEY` in `.env`):
   ```bash
   npm run stripe:yearly-prices
   ```

2. **What the script does**
   - For each active product that has a **monthly** default price, creates a **yearly** price: amount = 80% of monthly × 12 (e.g. $15/mo → $144/year).
   - Skips products that already have a yearly price.
   - Sets product metadata `priceFounderYearlyCents` when `priceFounderCents` exists (founder yearly = 80% × 12 × founder monthly).

3. After running, the pricing page "Yearly" toggle will send users to Stripe Checkout with the correct yearly price.

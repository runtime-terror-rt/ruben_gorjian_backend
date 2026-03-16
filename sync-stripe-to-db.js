#!/usr/bin/env node

/**
 * Sync Stripe Products to Database
 * This script fetches all active products from Stripe and syncs them to the database
 */

const { PrismaClient } = require('@prisma/client');
const Stripe = require('stripe');

const prisma = new PrismaClient();

async function syncStripePlansToDatabase() {
  console.log('🔄 Syncing Stripe products to database...\n');

  // Check if Stripe key is configured
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    console.error('❌ Error: STRIPE_SECRET_KEY environment variable not set');
    console.log('\nPlease set it in your .env file:');
    console.log('STRIPE_SECRET_KEY=sk_test_...\n');
    process.exit(1);
  }

  console.log('🔗 Database URL:', process.env.DATABASE_URL ? 'Set' : 'Not set');

  const stripe = new Stripe(stripeSecretKey);

  try {
    // Fetch all active products from Stripe
    console.log('📦 Fetching products from Stripe...');
    const products = await stripe.products.list({
      active: true,
      limit: 100,
    });

    console.log(`✅ Found ${products.data.length} active products in Stripe\n`);

    let syncedCount = 0;
    let skippedCount = 0;

    for (const product of products.data) {
      const metadata = product.metadata || {};

      // Skip products without a code
      if (!metadata.code) {
        console.log(`⚠️  Skipping ${product.name} (no code in metadata)`);
        skippedCount++;
        continue;
      }

      // Fetch prices for this product
      const prices = await stripe.prices.list({
        product: product.id,
        active: true,
        limit: 10,
      });

      if (prices.data.length === 0) {
        console.log(`⚠️  Skipping ${product.name} (no active prices)`);
        skippedCount++;
        continue;
      }

      // Use the first active price (should only be one for our use case)
      const price = prices.data[0];

      const planData = {
        code: metadata.code,
        name: product.name,
        category: metadata.category || 'CALENDAR_ONLY',
        isJewelry: metadata.isJewelry?.toLowerCase() === 'true',
        platformLimit: metadata.platformLimit ? parseInt(metadata.platformLimit) : null,
        baseVisualQuota: metadata.baseVisualQuota ? parseInt(metadata.baseVisualQuota) : null,
        basePostQuota: metadata.basePostQuota ? parseInt(metadata.basePostQuota) : null,
        priceStandardCents: price.unit_amount || 0,
        priceFounderCents: metadata.priceFounderCents 
          ? parseInt(metadata.priceFounderCents) 
          : price.unit_amount || 0,
        stripePriceStandardId: price.id,
      };

      // Upsert to database
      await prisma.plan.upsert({
        where: { code: planData.code },
        update: planData,
        create: planData,
      });

      console.log(`✅ Synced: ${planData.name} (${planData.code}) - $${(planData.priceStandardCents / 100).toFixed(2)}/mo`);
      syncedCount++;
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🎉 Sync complete!`);
    console.log(`   Synced: ${syncedCount} plans`);
    console.log(`   Skipped: ${skippedCount} plans`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error) {
    console.error('❌ Error syncing plans:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the sync
syncStripePlansToDatabase()
  .then(() => {
    console.log('✨ Done! Your database is now in sync with Stripe.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

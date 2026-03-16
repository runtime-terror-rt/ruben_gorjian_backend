const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function exportPlans() {
  try {
    const plans = await prisma.plan.findMany();
    
    if (plans.length === 0) {
      console.log('No plans found in the database.');
      return;
    }

    // Get headers from first plan
    const headers = Object.keys(plans[0]).join(',');
    
    // Convert each plan to CSV row
    const rows = plans.map(plan => {
      return Object.values(plan).map(value => {
        // Handle null/undefined
        if (value === null || value === undefined) return '';
        // Handle strings with commas/quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        // Handle dates
        if (value instanceof Date) {
          return value.toISOString();
        }
        return value;
      }).join(',');
    });

    const csv = [headers, ...rows].join('\n');
    
    fs.writeFileSync('./plan_db.csv', csv, 'utf8');
    console.log(`✓ Exported ${plans.length} plans to plan_db.csv`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

exportPlans();

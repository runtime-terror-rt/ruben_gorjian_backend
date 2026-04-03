-- Add admin route-level permission table
CREATE TABLE "AdminRoutePermission" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "pathPattern" TEXT NOT NULL,
  "description" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "grantedByAdminId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdminRoutePermission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminRoutePermission_adminUserId_idx" ON "AdminRoutePermission"("adminUserId");
CREATE INDEX "AdminRoutePermission_grantedByAdminId_idx" ON "AdminRoutePermission"("grantedByAdminId");
CREATE INDEX "AdminRoutePermission_method_idx" ON "AdminRoutePermission"("method");
CREATE INDEX "AdminRoutePermission_pathPattern_idx" ON "AdminRoutePermission"("pathPattern");

ALTER TABLE "AdminRoutePermission"
  ADD CONSTRAINT "AdminRoutePermission_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdminRoutePermission"
  ADD CONSTRAINT "AdminRoutePermission_grantedByAdminId_fkey"
  FOREIGN KEY ("grantedByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

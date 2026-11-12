/*
  Warnings:

  - The primary key for the `attributed_orders` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "attributed_orders" DROP CONSTRAINT "attributed_orders_pkey",
ADD COLUMN     "product_id" TEXT NOT NULL DEFAULT '',
ADD CONSTRAINT "attributed_orders_pkey" PRIMARY KEY ("shop_id", "order_id", "video_id", "kind", "product_id");

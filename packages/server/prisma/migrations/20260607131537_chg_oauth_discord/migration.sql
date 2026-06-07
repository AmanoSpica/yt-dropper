/*
  Warnings:

  - You are about to drop the column `github_id` on the `AuthUser` table. All the data in the column will be lost.
  - You are about to drop the `AllowedEmail` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[discord_id]` on the table `AuthUser` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `discord_id` to the `AuthUser` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "AuthUser_email_key";

-- DropIndex
DROP INDEX "AuthUser_github_id_key";

-- AlterTable
ALTER TABLE "AuthUser" DROP COLUMN "github_id",
ADD COLUMN     "discord_id" TEXT NOT NULL,
ALTER COLUMN "email" DROP NOT NULL;

-- DropTable
DROP TABLE "AllowedEmail";

-- CreateTable
CREATE TABLE "AllowedDiscordUser" (
    "id" TEXT NOT NULL,
    "discord_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllowedDiscordUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllowedDiscordUser_discord_id_key" ON "AllowedDiscordUser"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "AuthUser_discord_id_key" ON "AuthUser"("discord_id");

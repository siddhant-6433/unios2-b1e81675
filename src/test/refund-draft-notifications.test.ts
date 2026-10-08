// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

let db: PGlite;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("refund draft notifications on PostgreSQL", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TYPE public.app_role AS ENUM ('super_admin', 'accountant');
      CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
      CREATE TABLE public.notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        type text NOT NULL,
        title text NOT NULL,
        body text,
        link text
      );
      CREATE TABLE public.students (id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE public.leads (id uuid PRIMARY KEY, name text NOT NULL);
      CREATE TABLE public.fee_refunds (
        id uuid PRIMARY KEY,
        student_id uuid,
        lead_id uuid,
        total_amount numeric NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'draft'
      );
      INSERT INTO public.user_roles VALUES
        ('${uid(1)}', 'super_admin'),
        ('${uid(2)}', 'super_admin'),
        ('${uid(3)}', 'accountant');
      INSERT INTO public.students VALUES ('${uid(10)}', 'Asha Verma');
      INSERT INTO public.leads VALUES ('${uid(11)}', 'Rohan Mehta');
    `);
    await db.exec(readMigration("notify_super_admins_of_refund_drafts"));
  }, 30000);

  afterAll(async () => {
    await db?.close();
  });

  it("notifies every super admin for student and lead drafts with the right amount and link", async () => {
    await db.exec(`DELETE FROM public.notifications`);
    // Student refunds are inserted with a zero total and finalized later.
    await db.exec("BEGIN");
    await db.query(
      `INSERT INTO public.fee_refunds (id, student_id, total_amount, status) VALUES ($1, $2, 0, 'draft')`,
      [uid(20), uid(10)],
    );
    await db.query(`UPDATE public.fee_refunds SET total_amount = 1234.5 WHERE id = $1`, [uid(20)]);
    await db.query(`UPDATE public.fee_refunds SET total_amount = 1300 WHERE id = $1`, [uid(20)]);
    await db.exec("COMMIT");

    // Lead refunds are inserted with their final amount.
    await db.query(
      `INSERT INTO public.fee_refunds (id, lead_id, total_amount, status) VALUES ($1, $2, 2500, 'draft')`,
      [uid(21), uid(11)],
    );

    const notifications = (await db.query<{
      user_id: string;
      title: string;
      body: string;
      link: string;
    }>(`SELECT user_id, title, body, link FROM public.notifications ORDER BY link, user_id`)).rows;

    expect(notifications).toHaveLength(4);
    expect(notifications.filter((n) => n.user_id === uid(1))).toHaveLength(2);
    expect(notifications.filter((n) => n.user_id === uid(2))).toHaveLength(2);
    expect(notifications.every((n) => n.title === "New refund request")).toBe(true);
    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        body: "Asha Verma · ₹1,300.00 is awaiting approval.",
        link: `/finance?tab=refunds&status=draft&refund_id=${uid(20)}`,
      }),
      expect.objectContaining({
        body: "Rohan Mehta · ₹2,500.00 is awaiting approval.",
        link: `/finance?tab=refunds&status=draft&refund_id=${uid(21)}`,
      }),
    ]));
    expect(notifications.some((n) => n.user_id === uid(3))).toBe(false);
  });

  it("ignores zero-total drafts and non-draft refunds", async () => {
    await db.exec(`DELETE FROM public.notifications`);
    await db.exec(`
      INSERT INTO public.fee_refunds (id, student_id, total_amount, status)
        VALUES ('${uid(30)}', '${uid(10)}', 0, 'draft'),
               ('${uid(31)}', '${uid(10)}', 450, 'approved');
    `);

    expect((await db.query(`SELECT id FROM public.notifications`)).rows).toHaveLength(0);
  });

  it("does not notify a draft rejected before the transaction commits", async () => {
    await db.exec("DELETE FROM public.notifications; BEGIN");
    await db.query(
      `INSERT INTO public.fee_refunds (id, student_id, total_amount, status) VALUES ($1, $2, 900, 'draft')`,
      [uid(40), uid(10)],
    );
    await db.query(`UPDATE public.fee_refunds SET status = 'rejected' WHERE id = $1`, [uid(40)]);
    await db.exec("COMMIT");

    expect((await db.query(`SELECT id FROM public.notifications`)).rows).toHaveLength(0);
  });
});

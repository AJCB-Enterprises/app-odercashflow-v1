INSERT INTO reminder_settings (id, type, days_before, frequency_days, send_time, timezone, template)
VALUES
  (1, 'payment', 3, 2, '08:00', 'Asia/Manila',
   'Hi {{contact}}, this is a friendly reminder that invoice {{invoice}} for {{amount}} is due on {{due}}. Use your secure link below to upload your payment receipt — no login needed.'),
  (2, 'order', 0, 7, '09:00', 'Asia/Manila',
   'Hi {{contact}}, order {{order}} is awaiting action. Your agent will follow up, or expect an update soon.')
ON CONFLICT (id) DO NOTHING;

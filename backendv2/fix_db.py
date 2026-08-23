import sqlite3
conn = sqlite3.connect('products.db')
c = conn.cursor()
c.execute("UPDATE validation_issues SET severity = 'medium' WHERE issue_type IN ('casing', 'uom_spacing') OR description LIKE '%number + space + unit%' OR description LIKE '%lowercase characters%'")
c.execute("UPDATE products SET commerce_ready = 1 WHERE overall_confidence >= 0.70 AND id NOT IN (SELECT product_id FROM validation_issues WHERE severity = 'high')")
conn.commit()
print('Fixed!')

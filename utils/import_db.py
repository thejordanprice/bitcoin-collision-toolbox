import pandas as pd
from pymongo import MongoClient
from tqdm import tqdm
import time

# MongoDB connection
client = MongoClient('mongodb://localhost:27017/')
db = client['bitcoin']
collection = db['addresses']

# Read the TSV file into a pandas DataFrame
df = pd.read_csv('db.tsv', sep='\t')

# Function to convert satoshi to BTC
def satoshi_to_btc(satoshi_value):
    return satoshi_value / 100_000_000

# Batch size for bulk inserts
batch_size = 1000

# Total number of rows in the DataFrame
total_rows = len(df)

# Start time to calculate ETA
start_time = time.time()

# Buffer to store the batch of documents to insert
batch = []

# Progress bar setup
with tqdm(total=total_rows, desc="Inserting Data", unit="record") as pbar:
    for index, row in df.iterrows():
        address = row['address']
        balance = row['balance']
        btc_balance = satoshi_to_btc(balance)

        document = {
            "_id": address,
            "balance": btc_balance
        }

        # Add document to the batch
        batch.append(document)

        # If the batch size is reached, perform the batch insert
        if len(batch) == batch_size:
            try:
                collection.insert_many(batch, ordered=False)
            except Exception as e:
                print(f"Error inserting batch: {e}")
            batch.clear()

            # Update the progress bar
            pbar.update(batch_size)

            # Calculate and display ETA
            elapsed_time = time.time() - start_time
            remaining_time = elapsed_time / (index + 1) * (total_rows - (index + 1))
            pbar.set_postfix({
                "Progress": f"{(index + 1) / total_rows * 100:.2f}%",
                "ETA": f"{remaining_time / 60:.2f} min"
            })

    # Insert remaining records in the batch (if any)
    if batch:
        try:
            collection.insert_many(batch, ordered=False)
        except Exception as e:
            print(f"Error inserting final batch: {e}")
        pbar.update(len(batch))

print("Data import complete!")

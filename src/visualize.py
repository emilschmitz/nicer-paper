import json
import os
import matplotlib.pyplot as plt
import pandas as pd

# Paths
EVAL_JSON = 'eval_results.json'
ARTIFACT_DIR = '/home/emil/.gemini/antigravity-cli/brain/0b015264-e036-4be6-bce2-3081b900d6f0'
os.makedirs(ARTIFACT_DIR, exist_ok=True)

def main():
    if not os.path.exists(EVAL_JSON):
        print(f"Error: {EVAL_JSON} not found. Run the JS evaluation script first.")
        return

    with open(EVAL_JSON, 'r') as f:
        data = json.load(f)

    # Convert to DataFrame
    df = pd.DataFrame(data)
    
    # Calculate percentages
    df['correct_pct'] = (df['correct_urls'] / df['annotations_count']) * 100
    df['missed_pct'] = (df['missed_urls'] / df['annotations_count']) * 100
    df['mismatched_pct'] = (df['mismatched_urls'] / df['annotations_count']) * 100
    
    # Clean paper names for plotting
    df['paper_short'] = df['paper'].apply(lambda x: x.split('_')[0] + '_' + x.split('_')[1][:10] if len(x.split('_')) > 1 else x)

    # Set up matplotlib style
    plt.style.use('ggplot')
    fig_width = 10
    fig_height = 6

    # --- Plot 1: Accuracy Breakdown by Paper ---
    plt.figure(figsize=(fig_width, fig_height))
    bars_correct = plt.bar(df['paper_short'], df['correct_pct'], label='Correct / Match', color='#2ca02c', alpha=0.8)
    bars_missed = plt.bar(df['paper_short'], df['missed_pct'], bottom=df['correct_pct'], label='Missed URL', color='#d62728', alpha=0.8)
    bars_mismatched = plt.bar(df['paper_short'], df['mismatched_pct'], bottom=df['correct_pct'] + df['missed_pct'], label='Mismatched URL', color='#ff7f0e', alpha=0.8)
    
    plt.ylabel('Percentage (%)')
    plt.title('Citation Link Extraction Accuracy by Paper')
    plt.xticks(rotation=15, ha='right')
    plt.ylim(0, 105)
    plt.legend(loc='lower left')
    
    # Add values on top of bars
    for idx, row in df.iterrows():
        total_y = 0
        if row['correct_urls'] > 0:
            plt.text(idx, row['correct_pct']/2, f"{row['correct_urls']}", ha='center', va='center', color='white', fontweight='bold')
        if row['missed_urls'] > 0:
            plt.text(idx, row['correct_pct'] + row['missed_pct']/2, f"{row['missed_urls']}", ha='center', va='center', color='white', fontweight='bold')
            
    plt.tight_layout()
    accuracy_plot_path = os.path.join(ARTIFACT_DIR, 'accuracy_by_paper.png')
    plt.savefig(accuracy_plot_path, dpi=150)
    plt.close()
    print(f"Saved accuracy chart to: {accuracy_plot_path}")

    # --- Plot 2: Processing Latency by Paper ---
    plt.figure(figsize=(fig_width, fig_height))
    colors = ['#1f77b4' if x < 2000 else '#d62728' for x in df['latency_ms']]
    bars_latency = plt.bar(df['paper_short'], df['latency_ms'], color=colors, alpha=0.8)
    
    plt.ylabel('Latency (ms)')
    plt.title('PDF Parsing Latency per Paper (ms)')
    plt.xticks(rotation=15, ha='right')
    
    # Add values on top of bars
    for idx, row in df.iterrows():
        plt.text(idx, row['latency_ms'] + (row['latency_ms']*0.02), f"{row['latency_ms']}ms", ha='center', va='bottom', fontweight='bold')
        
    plt.tight_layout()
    latency_plot_path = os.path.join(ARTIFACT_DIR, 'latency_by_paper.png')
    plt.savefig(latency_plot_path, dpi=150)
    plt.close()
    print(f"Saved latency chart to: {latency_plot_path}")

    # --- Plot 3: Cumulative Failures Breakdown ---
    plt.figure(figsize=(6, 6))
    total_correct = int(df['correct_urls'].sum())
    total_missed = int(df['missed_urls'].sum())
    total_mismatched = int(df['mismatched_urls'].sum())
    total_new_found = int(df['new_urls_found'].sum())
    
    labels = ['Correct Match', 'Missed Link', 'Mismatched Link', 'New Links Found']
    sizes = [total_correct, total_missed, total_mismatched, total_new_found]
    colors_pie = ['#2ca02c', '#d62728', '#ff7f0e', '#9467bd']
    
    # Filter out 0 sizes to keep plot clean
    non_zero = [(l, s, c) for l, s, c in zip(labels, sizes, colors_pie) if s > 0]
    labels_nz, sizes_nz, colors_nz = zip(*non_zero)
    
    plt.pie(sizes_nz, labels=labels_nz, autopct='%1.1f%%', colors=colors_nz, startangle=140, 
            textprops={'fontsize': 10, 'weight': 'bold'})
    plt.title('Overall Evaluation Results Breakdown')
    plt.tight_layout()
    
    pie_plot_path = os.path.join(ARTIFACT_DIR, 'overall_results_breakdown.png')
    plt.savefig(pie_plot_path, dpi=150)
    plt.close()
    print(f"Saved overall breakdown pie chart to: {pie_plot_path}")

if __name__ == '__main__':
    main()

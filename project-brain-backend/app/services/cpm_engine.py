import pandas as pd
from typing import List, Dict

class CPMEngine:
    @staticmethod
    def calculate_cpm(activities: List[Dict]):
        """
        Input: List of dicts with {id, duration, predecessors: [ids]}
        Logic: Forward Pass (ES, EF) -> Backward Pass (LS, LF) -> Slack
        """
        df = pd.DataFrame(activities)
        df['es'] = 0
        df['ef'] = 0
        df['ls'] = 0
        df['lf'] = 0
        
        # 1. Forward Pass
        for i, row in df.iterrows():
            preds = row['predecessors']
            if not preds:
                df.at[i, 'es'] = 0
            else:
                pred_efs = df[df['id'].isin(preds)]['ef']
                df.at[i, 'es'] = pred_efs.max() if not pred_efs.empty else 0
            df.at[i, 'ef'] = df.at[i, 'es'] + row['duration']

        # 2. Backward Pass
        max_ef = df['ef'].max()
        df['lf'] = max_ef
        
        # Reverse iterate for backward pass
        for i in reversed(range(len(df))):
            row = df.iloc[i]
            successors = df[df['predecessors'].apply(lambda x: row['id'] in x if x else False)]
            if not successors.empty:
                df.at[i, 'lf'] = successors['ls'].min()
            df.at[i, 'ls'] = df.at[i, 'lf'] - row['duration']

        df['slack'] = df['lf'] - df['ef']
        df['is_critical'] = df['slack'] == 0
        
        return df.to_dict(orient='records')
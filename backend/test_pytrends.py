from pytrends.request import TrendReq
import pandas as pd

def test_trends(query):
    try:
        print(f"Testing trends for: {query}")
        # Using standard params
        pytrends = TrendReq(hl='en-US', tz=360)
        kw_list = [query]
        
        # Try a broader payload first to see if it works at all
        pytrends.build_payload(kw_list, cat=0, timeframe='today 12-m', geo='IN')
        df = pytrends.interest_over_time()
        
        if df.empty:
            print("No data found (DataFrame empty)")
        else:
            print("Data found!")
            print(df.tail())
            
    except Exception as e:
        print(f"Error occurred: {str(e)}")

if __name__ == "__main__":
    test_trends("Summer Fashion")
    test_trends("Diwali fashion trends")

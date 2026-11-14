import {
  App as WearablesApp,
  Page,
  ScrollView,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';

// Placeholder screen: proves the deployed app loads on the glasses.
// Recipe steps (feature 1) replace this.
export default function App() {
  return (
    <WearablesApp>
      <Page headerText="Cooking Buddy" enableSystemBarInset={false}>
        <ScrollView insetForHeader ariaLabel="Cooking Buddy" tabIndex={0}>
          <div className="content-inset">
            <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
              Recipes are on their way.
            </TextView>
          </div>
        </ScrollView>
      </Page>
    </WearablesApp>
  );
}

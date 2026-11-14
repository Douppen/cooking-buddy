import {Page, ScrollView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';

// Shown instead of the recipe list while it loads, when it fails, or when it's empty.
export function RecipeListStatusPage({message}: {message: string}) {
  return (
    <Page headerText="Recipes" enableSystemBarInset={false}>
      <ScrollView insetForHeader tabIndex={0} ariaLabel="Recipes">
        <div className="content-inset">
          <TextView as="p" textStyle={TextStyle.BODY2}>
            {message}
          </TextView>
        </div>
      </ScrollView>
    </Page>
  );
}

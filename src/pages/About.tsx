/**
 * Describes the basic purpose of using a relationship menu to aid the creation of a custom
 * relationship between two or more partners. This webapp provides a simple way to create, customize
 * and edit relationship menus with preferences for individual partners. It also supports the
 * sharing and comparison of relationship menus between partners through the use of menu urls.
 */

export const AboutPage = () => {
  return (
    <div className="about-page">
      <h1>About</h1>
      <p>
        This webapp provides a simple way to create, customize and edit
        relationship menus with preferences for individual partners. It also
        supports the sharing and comparison of relationship menus between
        partners through the use of menu urls.
      </p>
      <h2>How to Use</h2>
      <p>
        To get started, create a new relationship menu by clicking the "New
        Menu" button. You can then add new menu items and customize the
        preferences for each item. Once you're done, you can share the menu with
        your partner by copying the menu url. Your partner can then view and
        edit the menu, and share it back with you.
      </p>
      <h2>Comparison</h2>
      <p>
        You can compare multiple relationship menus by clicking the "Compare"
        button. This will display a color coded grid where columns are different
        people and rows are relationship menu items as normally displayed.
        Preferences for each relationship menu item should be displayed in this
        grid.
      </p>
      <h2>Feedback</h2>
      <p>
        If you have any feedback or suggestions for improvement, please feel
        free to reach out to us. We're always looking for ways to make the app
        better and more useful for our users.
      </p>
    </div>
  );
};

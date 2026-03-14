import Array "mo:core/Array";
import Map "mo:core/Map";
import Bool "mo:core/Bool";
import Time "mo:core/Time";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import Char "mo:core/Char";
import Float "mo:core/Float";



actor {
  type User = {
    name : Text;
    level : Nat;
    question : Text;
    answer : Text;
    uid : Text;
  };

  type SectorLog = {
    id : Text;
    sector : Text;
    title : Text;
    body : Text;
    author : Text;
    level : Nat;
    date : Text;
  };

  type AdminPost = {
    id : Text;
    author : Text;
    content : Text;
    minLvl : Nat;
    date : Text;
    sector : Text;
  };

  type MenuItem = {
    id : Text;
    facility : Text;
    name : Text;
    price : Float;
    description : Text;
    createdBy : Text;
    stock : Int;
  };

  type Transaction = {
    id : Text;
    member : Text;
    prevAmount : Float;
    newAmount : Float;
    changedBy : Text;
    ts : Text;
    description : Text;
  };

  type ActivityEntry = {
    msg : Text;
    ts : Text;
  };

  var nextId = 10000;
  let users = Map.empty<Text, User>();
  let sectorLogs = Map.empty<Text, SectorLog>();
  let adminPosts = Map.empty<Text, AdminPost>();
  let menuItems = Map.empty<Text, MenuItem>();
  let transactions = Map.empty<Text, Transaction>();
  let memberFunds = Map.empty<Text, Float>();
  let cardNumbers = Map.empty<Text, Text>();
  let contents = Map.empty<Text, Text>();
  let activities = Map.empty<Text, ActivityEntry>();

  var broadcast : Text = "";
  var lockdown = false;
  var officeLocations : Text = "";

  // User Authentication Methods
  public query ({ caller }) func userExists(name : Text) : async Bool {
    users.containsKey(name);
  };

  public query ({ caller }) func getAllUsers() : async [(Text, Nat)] {
    users.toArray().map(func((name, user)) { (name, user.level) });
  };

  public query ({ caller }) func getSecurityQuestion(name : Text) : async Text {
    switch (users.get(name)) {
      case (null) { Runtime.trap("Could not find user.") };
      case (?user) { user.question };
    };
  };

  public query ({ caller }) func loginUser(name : Text, answer : Text) : async User {
    switch (users.get(name)) {
      case (null) { Runtime.trap("Login failed. User with this name does not exist.") };
      case (?user) {
        let nameNormalized = Text.fromIter(
          name.toIter().map(
            func(c) {
              if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
                Char.fromNat32(c.toNat32() - 32);
              } else { c };
            }
          )
        );

        let answerNormalized = Text.fromIter(
          answer.toIter().map(
            func(c) {
              if (c.isAlphabetic() and c >= 'A' and c <= 'Z') {
                Char.fromNat32(c.toNat32() + 32);
              } else { c };
            }
          )
        );

        if (answerNormalized != user.answer) {
          Runtime.trap("Login failed. User recognized but security answer incorrect.");
        };

        if (nameNormalized != user.name) {
          Runtime.trap("Please use uppercase for your user name. Login passed but in an insecure way.");
        };

        user;
      };
    };
  };

  public query ({ caller }) func getUserCount() : async Nat {
    users.size();
  };

  public shared ({ caller }) func registerUser(name : Text, question : Text, answer : Text) : async () {
    let normalizedUser = Text.fromIter(
      name.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
            Char.fromNat32(c.toNat32() - 32);
          } else { c };
        }
      )
    );

    let normalizedAnswer = Text.fromIter(
      answer.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'A' and c <= 'Z') {
            Char.fromNat32(c.toNat32() + 32);
          } else { c };
        }
      )
    );

    let newUser : User = {
      name = normalizedUser;
      level = 1;
      question;
      answer = normalizedAnswer;
      uid = nextId.toText();
    };

    if (users.containsKey(newUser.name)) {
      Runtime.trap("User name " # newUser.name # " is already taken, please use a different name!");
    };

    users.add(newUser.name, newUser);
    nextId += 1;
  };

  public shared ({ caller }) func updateUserLevel(name : Text, newLevel : Nat) : async () {
    if (newLevel < 1 or newLevel > 7) {
      Runtime.trap("Invalid user level: can only be between 1 and 7.");
    };

    switch (users.get(name)) {
      case (null) { Runtime.trap("Could not update user level: user does not exist.") };
      case (?user) {
        let updatedUser = { user with level = newLevel };
        users.add(name, updatedUser);
      };
    };
  };

  public shared ({ caller }) func updateUserAnswer(name : Text, newAnswer : Text) : async () {
    switch (users.get(name)) {
      case (null) { Runtime.trap("Could not update answer: user does not exist.") };
      case (?user) {
        let updatedUser = { user with answer = newAnswer };
        users.add(name, updatedUser);
      };
    };
  };

  public shared ({ caller }) func deleteUser(name : Text) : async () {
    let nameNormalized = Text.fromIter(
      name.toIter().map(
        func(c) {
          if (c.isAlphabetic() and c >= 'a' and c <= 'z') {
            Char.fromNat32(c.toNat32() - 32);
          } else { c };
        }
      )
    );

    switch (users.get(nameNormalized)) {
      case (null) { Runtime.trap("Could not delete user: user does not exist.") };
      case (?_) { users.remove(nameNormalized) };
    };
  };

  // Portal Methods

  // 1. Sector Logs
  public shared ({ caller }) func addSectorLog(
    sector : Text,
    title : Text,
    body : Text,
    author : Text,
    level : Nat,
    date : Text,
  ) : async Text {
    let id = (sectorLogs.size() + 1).toText();
    let log : SectorLog = {
      id;
      sector;
      title;
      body;
      author;
      level;
      date;
    };
    sectorLogs.add(id, log);
    id;
  };

  public query ({ caller }) func getSectorLogs(sector : Text) : async [SectorLog] {
    sectorLogs.values().toArray().filter(
      func(log) {
        log.sector == sector;
      }
    );
  };

  public shared ({ caller }) func updateSectorLog(id : Text, newBody : Text) : async () {
    switch (sectorLogs.get(id)) {
      case (null) { Runtime.trap("Sector log not found") };
      case (?log) {
        let updatedLog = { log with body = newBody };
        sectorLogs.add(id, updatedLog);
      };
    };
  };

  public shared ({ caller }) func deleteSectorLog(id : Text) : async () {
    if (not sectorLogs.containsKey(id)) {
      Runtime.trap("Sector log not found");
    };
    sectorLogs.remove(id);
  };

  public query ({ caller }) func getAllSectorLogs() : async [SectorLog] {
    sectorLogs.values().toArray();
  };

  // 2. Admin Posts
  public shared ({ caller }) func addAdminPost(
    author : Text,
    content : Text,
    minLvl : Nat,
    date : Text,
    sector : Text,
  ) : async Text {
    let id = (adminPosts.size() + 1).toText();
    let post : AdminPost = {
      id;
      author;
      content;
      minLvl;
      date;
      sector;
    };
    adminPosts.add(id, post);
    id;
  };

  public query ({ caller }) func getAdminPosts(sector : Text) : async [AdminPost] {
    adminPosts.values().toArray().filter(
      func(post) {
        post.sector == sector;
      }
    );
  };

  public shared ({ caller }) func updateAdminPost(id : Text, newContent : Text) : async () {
    switch (adminPosts.get(id)) {
      case (null) { Runtime.trap("Admin post not found") };
      case (?post) {
        let updatedPost = { post with content = newContent };
        adminPosts.add(id, updatedPost);
      };
    };
  };

  public shared ({ caller }) func deleteAdminPost(id : Text) : async () {
    if (not adminPosts.containsKey(id)) {
      Runtime.trap("Admin post not found");
    };
    adminPosts.remove(id);
  };

  public query ({ caller }) func getAllAdminPosts() : async [AdminPost] {
    adminPosts.values().toArray();
  };

  // 3. Menu Items
  public shared ({ caller }) func addMenuItem(
    facility : Text,
    name : Text,
    price : Float,
    description : Text,
    createdBy : Text,
    stock : Int,
  ) : async Text {
    let id = (menuItems.size() + 1).toText();
    let item : MenuItem = {
      id;
      facility;
      name;
      price;
      description;
      createdBy;
      stock;
    };
    menuItems.add(id, item);
    id;
  };

  public query ({ caller }) func getMenuItems(facility : Text) : async [MenuItem] {
    menuItems.values().toArray().filter(
      func(item) {
        item.facility == facility;
      }
    );
  };

  public shared ({ caller }) func updateMenuItemStock(id : Text, newStock : Int) : async () {
    switch (menuItems.get(id)) {
      case (null) { Runtime.trap("Menu item not found") };
      case (?item) {
        let updatedItem = { item with stock = newStock };
        menuItems.add(id, updatedItem);
      };
    };
  };

  public shared ({ caller }) func deleteMenuItem(id : Text) : async () {
    if (not menuItems.containsKey(id)) {
      Runtime.trap("Menu item not found");
    };
    menuItems.remove(id);
  };

  public query ({ caller }) func getAllMenuItems() : async [MenuItem] {
    menuItems.values().toArray();
  };

  // 4. Transactions
  public shared ({ caller }) func addTransaction(
    member : Text,
    prevAmount : Float,
    newAmount : Float,
    changedBy : Text,
    ts : Text,
    description : Text,
  ) : async Text {
    let id = (transactions.size() + 1).toText();
    let transaction : Transaction = {
      id;
      member;
      prevAmount;
      newAmount;
      changedBy;
      ts;
      description;
    };
    transactions.add(id, transaction);
    id;
  };

  public query ({ caller }) func getMemberTransactions(member : Text) : async [Transaction] {
    transactions.values().toArray().filter(
      func(transaction) {
        transaction.member == member;
      }
    );
  };

  public query ({ caller }) func getAllTransactions() : async [Transaction] {
    transactions.values().toArray();
  };

  // 5. Member Funds
  public query ({ caller }) func getMemberFunds(name : Text) : async Float {
    switch (memberFunds.get(name)) {
      case (null) { 0.0 };
      case (?amount) { amount };
    };
  };

  public shared ({ caller }) func setMemberFunds(name : Text, amount : Float) : async () {
    memberFunds.add(name, amount);
  };

  public query ({ caller }) func getAllMemberFunds() : async [(Text, Float)] {
    memberFunds.toArray();
  };

  // 6. Card Numbers
  public query ({ caller }) func getCardNumber(name : Text) : async Text {
    switch (cardNumbers.get(name)) {
      case (null) { "" };
      case (?cardNum) { cardNum };
    };
  };

  public shared ({ caller }) func setCardNumber(name : Text, cardNum : Text) : async () {
    cardNumbers.add(name, cardNum);
  };

  // 7. Emergency Broadcast
  public query ({ caller }) func getBroadcast() : async Text {
    broadcast;
  };

  public shared ({ caller }) func setBroadcast(msg : Text) : async () {
    broadcast := msg;
  };

  public shared ({ caller }) func clearBroadcast() : async () {
    broadcast := "";
  };

  // 8. Lockdown State
  public query ({ caller }) func getLockdown() : async Bool {
    lockdown;
  };

  public shared ({ caller }) func setLockdown(active : Bool) : async () {
    lockdown := active;
  };

  // 9. Office Locations
  public query ({ caller }) func getOfficeLocations() : async Text {
    officeLocations;
  };

  public shared ({ caller }) func setOfficeLocations(json : Text) : async () {
    officeLocations := json;
  };

  // 10. Activity Log
  public shared ({ caller }) func addActivity(msg : Text, ts : Text) : async () {
    let id = (activities.size() + 1).toText();
    let entry : ActivityEntry = {
      msg;
      ts;
    };
    activities.add(id, entry);
  };

  public query ({ caller }) func getActivities() : async [ActivityEntry] {
    activities.values().toArray();
  };

  public shared ({ caller }) func clearOldActivities() : async () {
    if (activities.size() > 100) {
      let allEntries = activities.values().toArray();
      activities.clear();
      let entriesToKeep = allEntries.sliceToArray(allEntries.size().toInt() - 100, allEntries.size().toInt());
      var i = 0;
      while (i < entriesToKeep.size()) {
        activities.add(i.toText(), entriesToKeep[i]);
        i += 1;
      };
    };
  };

  // 11. About Content
  public query ({ caller }) func getContent(key : Text) : async Text {
    switch (contents.get(key)) {
      case (null) { "" };
      case (?value) { value };
    };
  };

  public shared ({ caller }) func setContent(key : Text, value : Text) : async () {
    contents.add(key, value);
  };
};
